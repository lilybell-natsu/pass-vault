// app.js — 画面遷移・状態管理・一覧描画・編集フォーム
'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- アプリ状態（すべてメモリ上のみ。ロック時に破棄） ----
  let blob = null;          // localStorageに保存されている全体構造
  let vaultKeyBytes = null; // 復号後の vaultKey（メモリ上のみ）
  let entries = [];         // 復号済みエントリ配列
  let expandedId = null;    // 一覧で開いているカード
  let autoLockMs = 5 * 60 * 1000;
  let idleTimer = null;
  let pendingRotate = null; // 再発行フロー中の一時データ

  // ==================================================
  // 画面切り替え
  // ==================================================
  function showScreen(id) {
    $$('.screen').forEach((el) => el.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  // ==================================================
  // 初期化
  // ==================================================
  async function init() {
    if (!PassVaultStorage.hasVault()) {
      showScreen('#screen-setup');
    } else {
      blob = PassVaultStorage.loadBlob();
      showScreen('#screen-lock');
    }
    bindGlobalEvents();
  }

  // ==================================================
  // 初回セットアップ
  // ==================================================
  let setupKeys = null; // { vaultKeyBytes, primaryBytes, backupBytes }

  async function generateSetup() {
    const vk = PassVaultCrypto.generateVaultKeyBytes();
    const primary = PassVaultAccessKey.generate();
    const backup = PassVaultAccessKey.generate();
    setupKeys = { vaultKeyBytes: vk, primaryBytes: primary, backupBytes: backup };

    PassVaultQr.render($('#qr-primary'), PassVaultAccessKey.toQrPayload(primary));
    $('#text-primary').textContent = PassVaultAccessKey.toDisplayString(primary);
    PassVaultQr.render($('#qr-backup'), PassVaultAccessKey.toQrPayload(backup));
    $('#text-backup').textContent = PassVaultAccessKey.toDisplayString(backup);

    $('#setup-step-intro').classList.add('hidden');
    $('#setup-step-keys').classList.remove('hidden');
  }

  function updateSetupContinueState() {
    const ok = $('#check-primary').checked && $('#check-backup').checked;
    $('#btn-setup-continue').disabled = !ok;
  }

  async function completeSetup() {
    const { vaultKeyBytes: vk, primaryBytes, backupBytes } = setupKeys;
    const wrappedPrimary = await PassVaultCrypto.wrapVaultKey(vk, primaryBytes);
    const wrappedBackup = await PassVaultCrypto.wrapVaultKey(vk, backupBytes);
    const vaultRecord = await PassVaultCrypto.encryptVault(vk, { entries: [] });

    blob = {
      version: 2,
      vault: vaultRecord,
      wrappedKeys: { primary: wrappedPrimary, backup: wrappedBackup },
    };
    PassVaultStorage.saveBlob(blob);

    vaultKeyBytes = vk;
    entries = [];
    setupKeys = null;

    enterApp();
  }

  // ==================================================
  // ロック / アンロック
  // ==================================================
  async function tryUnlock(inputStr) {
    hideLockError();
    let accessBytes;
    try {
      accessBytes = PassVaultAccessKey.parseInput(inputStr);
    } catch (e) {
      showLockError('アクセスキーの形式が正しくありません。');
      return;
    }

    let vk = await PassVaultCrypto.unwrapVaultKey(blob.wrappedKeys.primary, accessBytes);
    if (!vk) vk = await PassVaultCrypto.unwrapVaultKey(blob.wrappedKeys.backup, accessBytes);

    if (!vk) {
      showLockError('解錠できません。アクセスキーをご確認ください。');
      return;
    }

    try {
      const data = await PassVaultCrypto.decryptVault(vk, blob.vault);
      vaultKeyBytes = vk;
      entries = data.entries || [];
      $('#lock-input').value = '';
      enterApp();
    } catch (e) {
      showLockError('データの復号に失敗しました。バックアップの破損の可能性があります。');
    }
  }

  function showLockError(msg) {
    const el = $('#lock-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideLockError() { $('#lock-error').classList.add('hidden'); }

  function lockNow() {
    vaultKeyBytes = null;
    entries = [];
    expandedId = null;
    PassVaultQrScan.stop();
    clearTimeout(idleTimer);
    $('#lock-scan-area').classList.add('hidden');
    $('#lock-form-area').classList.remove('hidden');
    showScreen('#screen-lock');
  }

  function enterApp() {
    showScreen('#screen-app');
    renderList();
    resetIdleTimer();
  }

  // ---- 自動ロック ----
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(lockNow, autoLockMs);
  }
  function bindIdleResetEvents() {
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
      document.addEventListener(ev, () => {
        if (!vaultKeyBytes) return;
        resetIdleTimer();
      }, { passive: true });
    });
  }

  // ---- QRスキャン(ロック画面) ----
  async function startLockScan() {
    if (!PassVaultQrScan.isSupported()) {
      toast('このブラウザはカメラ読み取りに対応していません。貼り付けをご利用ください。');
      return;
    }
    $('#lock-form-area').classList.add('hidden');
    $('#lock-scan-area').classList.remove('hidden');
    await PassVaultQrScan.start(
      $('#lock-video'),
      (value) => {
        $('#lock-scan-area').classList.add('hidden');
        $('#lock-form-area').classList.remove('hidden');
        tryUnlock(value);
      },
      () => {
        toast('カメラを起動できませんでした。貼り付けをご利用ください。');
        $('#lock-scan-area').classList.add('hidden');
        $('#lock-form-area').classList.remove('hidden');
      }
    );
  }
  function cancelLockScan() {
    PassVaultQrScan.stop();
    $('#lock-scan-area').classList.add('hidden');
    $('#lock-form-area').classList.remove('hidden');
  }

  // ==================================================
  // 保存（再暗号化）
  // ==================================================
  async function persistEntries() {
    const vaultRecord = await PassVaultCrypto.encryptVault(vaultKeyBytes, { entries });
    blob.vault = vaultRecord;
    PassVaultStorage.saveBlob(blob);
  }

  // ==================================================
  // 一覧描画
  // ==================================================
  function matchesQuery(entry, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return [entry.serviceName, entry.loginId, entry.category, entry.url]
      .some((v) => (v || '').toLowerCase().includes(q));
  }

  function renderList() {
    const q = $('#search-input').value.trim();
    const list = $('#entry-list');
    list.innerHTML = '';

    const sorted = [...entries].sort((a, b) => (a.serviceName || '').localeCompare(b.serviceName || '', 'ja'));
    const filtered = sorted.filter((e) => matchesQuery(e, q));

    $('#empty-state').classList.toggle('hidden', entries.length !== 0);

    filtered.forEach((entry) => list.appendChild(buildEntryCard(entry)));
  }

  function buildEntryCard(entry) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.id = entry.id;

    const top = document.createElement('div');
    top.className = 'entry-top';
    top.innerHTML = `
      <div>
        <div class="entry-name">${escapeHtml(entry.serviceName || '(名称未設定)')}</div>
        <div class="entry-sub">${escapeHtml(entry.loginId || '')}</div>
      </div>
      ${entry.category ? `<span class="entry-chip">${escapeHtml(entry.category)}</span>` : ''}
    `;
    top.addEventListener('click', () => {
      expandedId = expandedId === entry.id ? null : entry.id;
      renderList();
    });
    card.appendChild(top);

    if (expandedId === entry.id) {
      card.appendChild(buildEntryDetail(entry));
    }
    return card;
  }

  function buildEntryDetail(entry) {
    const wrap = document.createElement('div');
    wrap.className = 'entry-rows';

    wrap.appendChild(buildCopyRow('ID', entry.loginId));
    wrap.appendChild(buildPasswordRow(entry.password));
    if (entry.url) wrap.appendChild(buildLinkRow(entry.url));
    if (entry.memo) wrap.appendChild(buildTextRow('メモ', entry.memo));
    if (entry.passwordChangedAt) wrap.appendChild(buildTextRow('変更日', entry.passwordChangedAt));
    if (entry.expiresAt) wrap.appendChild(buildTextRow('有効期限', entry.expiresAt));

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-small';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(entry); });
    actions.appendChild(editBtn);
    wrap.appendChild(actions);

    wrap.addEventListener('click', (e) => e.stopPropagation());
    return wrap;
  }

  function buildCopyRow(label, value) {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<span class="row-label">${label}</span><span class="row-value">${escapeHtml(value || '')}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '📋';
    btn.title = 'コピー';
    btn.addEventListener('click', () => copyToClipboard(value, false));
    row.appendChild(btn);
    return row;
  }

  function buildPasswordRow(password) {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<span class="row-label">パスワード</span><span class="row-value" data-masked="1">••••••••</span>`;
    const valEl = row.querySelector('.row-value');

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '👁';
    toggleBtn.title = '表示切替';
    toggleBtn.addEventListener('click', () => {
      const masked = valEl.dataset.masked === '1';
      valEl.textContent = masked ? password : '••••••••';
      valEl.dataset.masked = masked ? '0' : '1';
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'コピー（20秒後に自動クリア）';
    copyBtn.addEventListener('click', () => copyToClipboard(password, true));

    row.appendChild(toggleBtn);
    row.appendChild(copyBtn);
    return row;
  }

  function buildLinkRow(url) {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<span class="row-label">URL</span><span class="row-value"></span>`;
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url;
    a.style.color = 'inherit';
    row.querySelector('.row-value').appendChild(a);
    return row;
  }

  function buildTextRow(label, value) {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `<span class="row-label">${label}</span><span class="row-value">${escapeHtml(value)}</span>`;
    return row;
  }

  let clipboardClearTimer = null;
  async function copyToClipboard(text, autoClear) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(autoClear ? 'コピーしました（20秒後に自動クリア）' : 'コピーしました');
    } catch (e) {
      toast('コピーに失敗しました');
      return;
    }
    if (autoClear) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === text) await navigator.clipboard.writeText('');
        } catch (e) { /* clipboard-read 権限がない場合はベストエフォートで諦める */ }
      }, 20000);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ==================================================
  // エントリ 追加/編集フォーム
  // ==================================================
  function emptyEntry() {
    return {
      id: 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      serviceName: '', url: '', loginId: '', password: '', category: '', memo: '',
      updatedAt: new Date().toISOString(),
      passwordChangedAt: '', expiresAt: '', twoFABackupCodes: '',
      secretQuestions: [], customFields: [],
    };
  }

  function openAddModal() {
    fillForm(emptyEntry());
    $('#entry-modal-title').textContent = 'アカウントを追加';
    $('#btn-delete-entry').classList.add('hidden');
    openModal('#modal-entry');
  }

  function openEditModal(entry) {
    fillForm(entry);
    $('#entry-modal-title').textContent = 'アカウントを編集';
    $('#btn-delete-entry').classList.remove('hidden');
    openModal('#modal-entry');
  }

  function fillForm(entry) {
    $('#f-id').value = entry.id;
    $('#f-serviceName').value = entry.serviceName || '';
    $('#f-url').value = entry.url || '';
    $('#f-loginId').value = entry.loginId || '';
    $('#f-password').value = entry.password || '';
    $('#f-password').type = 'password';
    $('#f-category').value = entry.category || '';
    $('#f-memo').value = entry.memo || '';
    $('#f-passwordChangedAt').value = entry.passwordChangedAt || '';
    $('#f-expiresAt').value = entry.expiresAt || '';
    $('#f-twoFA').value = entry.twoFABackupCodes || '';
    updatePwStrength();

    $('#secret-questions-list').innerHTML = '';
    (entry.secretQuestions || []).forEach((qa) => addQuestionRow(qa.question, qa.answer));

    $('#custom-fields-list').innerHTML = '';
    (entry.customFields || []).forEach((f) => addCustomRow(f.label, f.value));
  }

  function addQuestionRow(question = '', answer = '') {
    const row = document.createElement('div');
    row.className = 'qa-row';
    row.innerHTML = `
      <input type="text" placeholder="質問" class="qa-question" value="${escapeAttr(question)}">
      <input type="text" placeholder="答え" class="qa-answer" value="${escapeAttr(answer)}">
      <button type="button" aria-label="削除">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    $('#secret-questions-list').appendChild(row);
  }

  function addCustomRow(label = '', value = '') {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="text" placeholder="ラベル" class="kv-label" value="${escapeAttr(label)}">
      <input type="text" placeholder="値" class="kv-value" value="${escapeAttr(value)}">
      <button type="button" aria-label="削除">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    $('#custom-fields-list').appendChild(row);
  }

  function escapeAttr(s) { return escapeHtml(s || ''); }

  function updatePwStrength() {
    const pw = $('#f-password').value;
    const el = $('#pw-strength');
    if (!pw) { el.textContent = ''; return; }
    const s = PassVaultGenerator.estimateStrength(pw);
    el.textContent = `強度: ${s.label}`;
  }

  function readFormEntry() {
    const questions = $$('#secret-questions-list .qa-row').map((row) => ({
      question: row.querySelector('.qa-question').value.trim(),
      answer: row.querySelector('.qa-answer').value.trim(),
    })).filter((q) => q.question || q.answer);

    const customFields = $$('#custom-fields-list .kv-row').map((row) => ({
      label: row.querySelector('.kv-label').value.trim(),
      value: row.querySelector('.kv-value').value.trim(),
    })).filter((f) => f.label || f.value);

    return {
      id: $('#f-id').value,
      serviceName: $('#f-serviceName').value.trim(),
      url: $('#f-url').value.trim(),
      loginId: $('#f-loginId').value.trim(),
      password: $('#f-password').value,
      category: $('#f-category').value.trim(),
      memo: $('#f-memo').value.trim(),
      updatedAt: new Date().toISOString(),
      passwordChangedAt: $('#f-passwordChangedAt').value,
      expiresAt: $('#f-expiresAt').value,
      twoFABackupCodes: $('#f-twoFA').value,
      secretQuestions: questions,
      customFields,
    };
  }

  async function submitEntryForm(e) {
    e.preventDefault();
    const data = readFormEntry();
    if (!data.serviceName || !data.loginId || !data.password) {
      toast('サービス名・ID・パスワードは必須です');
      return;
    }
    const idx = entries.findIndex((x) => x.id === data.id);
    if (idx >= 0) entries[idx] = data; else entries.push(data);

    await persistEntries();
    closeModal('#modal-entry');
    expandedId = data.id;
    renderList();
    toast('保存しました');
  }

  async function deleteCurrentEntry() {
    const id = $('#f-id').value;
    if (!confirm('このアカウントを削除しますか？')) return;
    entries = entries.filter((x) => x.id !== id);
    await persistEntries();
    closeModal('#modal-entry');
    expandedId = null;
    renderList();
    toast('削除しました');
  }

  // ==================================================
  // 設定: エクスポート / インポート
  // ==================================================
  function exportBackup() {
    PassVaultStorage.exportBlobAsFile(blob);
    toast('ダウンロードしました');
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!PassVaultStorage.isValidBlobShape(obj)) throw new Error('shape');
      if (!confirm('現在のデータを、選択したバックアップで置き換えます。よろしいですか？')) return;
      PassVaultStorage.saveBlob(obj);
      toast('復元しました。ロック画面から解錠してください。');
      lockNow();
      blob = obj;
    } catch (e) {
      toast('ファイルを読み込めませんでした。形式をご確認ください。');
    }
  }

  // ==================================================
  // アクセスキー再発行
  // ==================================================
  async function startRotateKeys() {
    const primary = PassVaultAccessKey.generate();
    const backup = PassVaultAccessKey.generate();
    const wrappedPrimary = await PassVaultCrypto.wrapVaultKey(vaultKeyBytes, primary);
    const wrappedBackup = await PassVaultCrypto.wrapVaultKey(vaultKeyBytes, backup);
    pendingRotate = { wrappedPrimary, wrappedBackup };

    PassVaultQr.render($('#qr-rotate-primary'), PassVaultAccessKey.toQrPayload(primary));
    $('#text-rotate-primary').textContent = PassVaultAccessKey.toDisplayString(primary);
    PassVaultQr.render($('#qr-rotate-backup'), PassVaultAccessKey.toQrPayload(backup));
    $('#text-rotate-backup').textContent = PassVaultAccessKey.toDisplayString(backup);

    closeModal('#modal-settings');
    openModal('#modal-rotate');
  }

  async function finishRotateKeys() {
    if (!pendingRotate) return;
    blob.wrappedKeys.primary = pendingRotate.wrappedPrimary;
    blob.wrappedKeys.backup = pendingRotate.wrappedBackup;
    PassVaultStorage.saveBlob(blob);
    pendingRotate = null;
    closeModal('#modal-rotate');
    toast('アクセスキーを再発行しました');
  }

  // ==================================================
  // イベント結線
  // ==================================================
  function bindGlobalEvents() {
    $('#btn-setup-generate').addEventListener('click', generateSetup);
    $('#check-primary').addEventListener('change', updateSetupContinueState);
    $('#check-backup').addEventListener('change', updateSetupContinueState);
    $('#btn-setup-continue').addEventListener('click', completeSetup);

    $('#btn-unlock').addEventListener('click', () => tryUnlock($('#lock-input').value));
    $('#lock-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) tryUnlock($('#lock-input').value);
    });
    $('#btn-scan-start').addEventListener('click', startLockScan);
    $('#btn-scan-cancel').addEventListener('click', cancelLockScan);

    $('#btn-lock-now').addEventListener('click', lockNow);
    $('#btn-add').addEventListener('click', openAddModal);
    $('#search-input').addEventListener('input', renderList);

    $('#entry-form').addEventListener('submit', submitEntryForm);
    $('#f-password').addEventListener('input', updatePwStrength);
    $('#btn-toggle-pw').addEventListener('click', () => {
      const f = $('#f-password');
      f.type = f.type === 'password' ? 'text' : 'password';
    });
    $('#btn-gen-pw').addEventListener('click', () => {
      $('#f-password').value = PassVaultGenerator.generate({ length: 18 });
      $('#f-password').type = 'text';
      updatePwStrength();
    });
    $('#btn-delete-entry').addEventListener('click', deleteCurrentEntry);
    $('#btn-add-question').addEventListener('click', () => addQuestionRow());
    $('#btn-add-custom').addEventListener('click', () => addCustomRow());

    $('#btn-settings').addEventListener('click', () => openModal('#modal-settings'));
    $('#f-autolock').addEventListener('change', (e) => {
      autoLockMs = Number(e.target.value) * 1000;
      resetIdleTimer();
    });
    $('#btn-export').addEventListener('click', exportBackup);
    $('#f-import').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importBackup(file);
      e.target.value = '';
    });
    $('#btn-rotate-keys').addEventListener('click', startRotateKeys);
    $('#btn-rotate-done').addEventListener('click', finishRotateKeys);

    $$('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => closeModal('#' + btn.dataset.close));
    });
    $$('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    bindIdleResetEvents();
  }

  // ==================================================
  // Service Worker
  // ==================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

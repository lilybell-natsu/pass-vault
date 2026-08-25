// storage.js — localStorage への暗号化blobの読み書き（唯一のレコードキー）

const PassVaultStorage = (() => {
  'use strict';

  const KEY = 'passVault.blob';

  function loadBlob() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('[pass-vault] failed to read storage', e);
      return null;
    }
  }

  function saveBlob(blob) {
    try {
      localStorage.setItem(KEY, JSON.stringify(blob));
      return true;
    } catch (e) {
      console.error('[pass-vault] failed to write storage', e);
      return false;
    }
  }

  function hasVault() {
    try {
      return !!localStorage.getItem(KEY);
    } catch (e) {
      return false;
    }
  }

  function exportBlobAsFile(blob) {
    const json = JSON.stringify(blob, null, 2);
    const file = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `pass-vault-backup_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function isValidBlobShape(obj) {
    return !!(obj && obj.vault && obj.vault.iv && obj.vault.ciphertext &&
      obj.wrappedKeys && obj.wrappedKeys.primary);
  }

  return { loadBlob, saveBlob, hasVault, exportBlobAsFile, isValidBlobShape, KEY };
})();

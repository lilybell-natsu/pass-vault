// crypto.js — 鍵導出・暗号化ヘルパー（Web Crypto API のみ、外部依存なし）
//
// 設計（仕様書 v0.2 準拠）:
//   vaultKey (AES-GCM 256bit, ランダム生成) がデータ本体の実際の暗号化鍵。
//   vaultKey 自体は、主/予備 2 本のアクセスキーからそれぞれ HKDF で導出した
//   KEK (Key Encryption Key) で AES-GCM 暗号化して「ラップ」し、2 系統保存する。
//   アクセスキーの原本はどこにも保存しない。

const PassVaultCrypto = (() => {
  'use strict';

  const HKDF_INFO = new TextEncoder().encode('pass-vault-kek-v1');
  const HKDF_SALT = new TextEncoder().encode('pass-vault-static-salt-v1'); // 秘匿不要（ドメイン分離用）

  function bufToB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  function generateVaultKeyBytes() {
    return randomBytes(32); // AES-256
  }

  async function importAesKey(rawBytes) {
    return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // アクセスキー(32byte) → KEK (AES-GCM鍵) を HKDF-SHA256 で導出
  async function deriveKek(accessKeyBytes) {
    const keyMaterial = await crypto.subtle.importKey('raw', accessKeyBytes, { name: 'HKDF' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // vaultKeyBytes をアクセスキー由来のKEKでラップ（AES-GCM暗号化）
  async function wrapVaultKey(vaultKeyBytes, accessKeyBytes) {
    const kek = await deriveKek(accessKeyBytes);
    const iv = randomBytes(12);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, vaultKeyBytes);
    return { iv: bufToB64(iv), wrapped: bufToB64(wrapped) };
  }

  // wrappedレコードをアクセスキーでアンラップ。鍵が違えば null を返す（例外を握りつぶす）
  async function unwrapVaultKey(wrappedRecord, accessKeyBytes) {
    if (!wrappedRecord) return null;
    try {
      const kek = await deriveKek(accessKeyBytes);
      const iv = b64ToBuf(wrappedRecord.iv);
      const wrapped = b64ToBuf(wrappedRecord.wrapped);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, wrapped);
      return new Uint8Array(plain);
    } catch (e) {
      return null; // 認証タグ検証失敗 = アクセスキーが違う
    }
  }

  // vault本体（任意のJSONオブジェクト）を vaultKey で暗号化
  async function encryptVault(vaultKeyBytes, obj) {
    const key = await importAesKey(vaultKeyBytes);
    const iv = randomBytes(12);
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return { iv: bufToB64(iv), ciphertext: bufToB64(ct) };
  }

  // vault本体を vaultKey で復号
  async function decryptVault(vaultKeyBytes, vaultRecord) {
    const key = await importAesKey(vaultKeyBytes);
    const iv = b64ToBuf(vaultRecord.iv);
    const ct = b64ToBuf(vaultRecord.ciphertext);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return {
    bufToB64, b64ToBuf, randomBytes,
    generateVaultKeyBytes,
    wrapVaultKey, unwrapVaultKey,
    encryptVault, decryptVault,
  };
})();

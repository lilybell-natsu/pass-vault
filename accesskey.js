// accesskey.js — アクセスキーの生成・表示用フォーマット・貼り付け/スキャン文字列の解析
//
// アクセスキーは 256bit のランダム値。人が入力しやすいよう Base32(RFC4648, パディングなし) で
// 表示し、5文字ずつハイフン区切りにする。QRコードにも同じ文字列（"PV1:" プレフィックス付き）を載せる。

const PassVaultAccessKey = (() => {
  'use strict';

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC4648 Base32
  const QR_PREFIX = 'PV1:';

  function base32Encode(bytes) {
    let bits = 0, value = 0, output = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        output += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) {
      output += ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
  }

  function base32Decode(str) {
    const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0;
    const out = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = ALPHABET.indexOf(clean[i]);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function generate() {
    return PassVaultCrypto.randomBytes(32);
  }

  // 表示・手動入力用の文字列（グループ区切り付き）: "ABCDE-FGHIJ-..."
  function toDisplayString(bytes) {
    const raw = base32Encode(bytes);
    return raw.match(/.{1,5}/g).join('-');
  }

  // QRコードに載せるペイロード文字列
  function toQrPayload(bytes) {
    return QR_PREFIX + base32Encode(bytes);
  }

  // 手動貼り付け／QRスキャン結果の文字列 → バイト列。長さが合わない場合は例外。
  function parseInput(str) {
    if (!str) throw new Error('empty');
    let s = str.trim();
    if (s.startsWith(QR_PREFIX)) s = s.slice(QR_PREFIX.length);
    const bytes = base32Decode(s);
    if (bytes.length !== 32) {
      throw new Error('invalid-length');
    }
    return bytes;
  }

  return { generate, toDisplayString, toQrPayload, parseInput };
})();

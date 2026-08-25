// generator.js — 登録するアカウント用パスワードの生成・簡易強度判定
// （Pass Vault自体の解錠に使うアクセスキーとは無関係。あくまでエントリ入力の補助機能）

const PassVaultGenerator = (() => {
  'use strict';

  const SETS = {
    lower: 'abcdefghijkmnpqrstuvwxyz',       // 紛らわしい l, o を除外
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',       // 紛らわしい I, O を除外
    digits: '23456789',                       // 紛らわしい 0, 1 を除外
    symbols: '!@#$%^&*-_=+?',
  };

  const SETS_FULL = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*-_=+?',
  };

  function generate({ length = 16, lower = true, upper = true, digits = true, symbols = true, excludeAmbiguous = true } = {}) {
    const table = excludeAmbiguous ? SETS : SETS_FULL;
    let pool = '';
    if (lower) pool += table.lower;
    if (upper) pool += table.upper;
    if (digits) pool += table.digits;
    if (symbols) pool += table.symbols;
    if (!pool) pool = table.lower + table.digits;

    const bytes = crypto.getRandomValues(new Uint32Array(length));
    let out = '';
    for (let i = 0; i < length; i++) {
      out += pool[bytes[i] % pool.length];
    }
    return out;
  }

  // 文字種の多様性 × 長さから概算エントロピーを出し、大まかな強度ラベルを返す
  function estimateStrength(password) {
    if (!password) return { label: '未入力', score: 0 };
    let poolSize = 0;
    if (/[a-z]/.test(password)) poolSize += 26;
    if (/[A-Z]/.test(password)) poolSize += 26;
    if (/[0-9]/.test(password)) poolSize += 10;
    if (/[^a-zA-Z0-9]/.test(password)) poolSize += 24;
    poolSize = poolSize || 1;

    const bits = password.length * Math.log2(poolSize);
    let label, score;
    if (bits < 40) { label = '弱い'; score = 1; }
    else if (bits < 60) { label = '普通'; score = 2; }
    else if (bits < 80) { label = '強い'; score = 3; }
    else { label = '非常に強い'; score = 4; }
    return { label, score, bits: Math.round(bits) };
  }

  return { generate, estimateStrength };
})();

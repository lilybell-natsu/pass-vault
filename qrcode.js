// qrcode.js — vendor/qrcode-gen.lib.js（kazuhikoarase/qrcode-generator, MIT）を使った
// QRコード描画ラッパー。セットアップ画面でアクセスキーを提示する用途に使う。

const PassVaultQr = (() => {
  'use strict';

  // container(要素) に text のQRコードを描画する。誤り訂正レベル M。
  function render(container, text) {
    container.innerHTML = '';
    const typeNumber = 0; // 自動判定
    const qr = qrcode(typeNumber, 'M');
    qr.addData(text);
    qr.make();

    const cellSize = 6;
    const margin = 4;
    // createSvgTag はスケーラブルで印刷にも耐えるためcanvasではなくSVGを使う
    const svgMarkup = qr.createSvgTag({ cellSize, margin, scalable: true });
    container.innerHTML = svgMarkup;
    const svg = container.querySelector('svg');
    if (svg) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'アクセスキーQRコード');
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.style.maxWidth = '220px';
      svg.style.display = 'block';
    }
  }

  return { render };
})();

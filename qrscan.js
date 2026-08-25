// qrscan.js — カメラ起動 + QR読み取り、および画像ファイルからのQR読み取り。
//
// vendor/jsqr.lib.js（cozmo/jsQR, MIT）による純JSデコードを使用。
// ブラウザ標準の BarcodeDetector APIに依存しないため、Safari/iOSを含む
// getUserMedia対応ブラウザ全般でカメラスキャンが動作する。

const PassVaultQrScan = (() => {
  'use strict';

  let stream = null;
  let rafId = null;
  let workCanvas = null;
  let workCtx = null;

  function isCameraSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // videoEl: <video> 要素。onDetect(text) が呼ばれたら自動的に停止する。
  async function start(videoEl, onDetect, onError) {
    if (!isCameraSupported()) {
      onError && onError(new Error('unsupported'));
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) {
      onError && onError(e);
      return;
    }
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', 'true');
    await videoEl.play();

    workCanvas = workCanvas || document.createElement('canvas');
    workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (!stream) return; // stop済み
      if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        workCanvas.width = videoEl.videoWidth;
        workCanvas.height = videoEl.videoHeight;
        workCtx.drawImage(videoEl, 0, 0, workCanvas.width, workCanvas.height);
        try {
          const imageData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            stop();
            onDetect && onDetect(code.data);
            return;
          }
        } catch (e) {
          // 1フレームの読み取り失敗は無視して継続
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  // 画像ファイル(端末フォルダ/フォトライブラリから選択)からQRコードを読み取る
  function decodeImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          URL.revokeObjectURL(url);
          resolve(code ? code.data : null);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image-load-failed')); };
      img.src = url;
    });
  }

  return { isCameraSupported, start, stop, decodeImageFile };
})();

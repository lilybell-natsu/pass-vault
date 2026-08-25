// qrscan.js — カメラ起動 + QR読み取り。
//
// ブラウザ標準の BarcodeDetector API のみを使用（外部ライブラリ不要）。
// 対応ブラウザ: Android Chrome / Edge 等（Chromium系）。Safari/Firefoxは非対応のため、
// isSupported() が false の場合は呼び出し側が手動貼り付け欄に誘導すること。

const PassVaultQrScan = (() => {
  'use strict';

  let stream = null;
  let detectorLoopId = null;

  function isSupported() {
    return ('BarcodeDetector' in window) &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // videoEl: <video> 要素。onDetect(text) が呼ばれたら自動的に停止する。
  // onError(err) はカメラ取得失敗時などに呼ばれる。
  async function start(videoEl, onDetect, onError) {
    if (!isSupported()) {
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
    await videoEl.play();

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

    const tick = async () => {
      if (!stream) return; // stop済み
      try {
        const codes = await detector.detect(videoEl);
        if (codes && codes.length > 0 && codes[0].rawValue) {
          const value = codes[0].rawValue;
          stop();
          onDetect && onDetect(value);
          return;
        }
      } catch (e) {
        // 1フレームの検出失敗は無視して継続
      }
      detectorLoopId = requestAnimationFrame(tick);
    };
    detectorLoopId = requestAnimationFrame(tick);
  }

  function stop() {
    if (detectorLoopId) {
      cancelAnimationFrame(detectorLoopId);
      detectorLoopId = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  return { isSupported, start, stop };
})();

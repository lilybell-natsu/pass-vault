# Pass Vault

アカウントIDとパスワードを端末内で暗号化して保管する、個人用パスワード管理PWA。
サーバーは持たず、GitHub Pages（静的サイト）＋ブラウザの `localStorage` だけで完結する。

Spending-Log / Fuel-Log / Home-Docs の姉妹プロジェクト。

## 特徴

- **マスターパスワード不要。** 初回セットアップ時に、主・予備2本の「アクセスキー」（256bitのランダム値）を自動発行してQRコード表示する。記憶する必要はなく、認証アプリのメモやパスワードマネージャー、印刷などで保管する。
- **エンベロープ暗号化。** データ本体は `vaultKey`（AES-GCM 256bit）で暗号化。`vaultKey` 自体は主・予備それぞれのアクセスキー由来の鍵でラップして2系統保存し、どちらか一方があれば解錠できる。
- **ゼロ知識。** アクセスキーの原本はアプリ内のどこにも保存されない。サーバーも存在しないため、開発者を含め誰もデータを復号できない。
- **1端末完結。** クラウド同期はしない。バックアップは暗号化済みのJSONファイルとしてエクスポート／インポートする。

## 使い方

1. 初回起動でアクセスキー（主・予備）が発行されるので、別々の場所に保管する。
2. 次回以降はロック画面でQRスキャンまたは貼り付けで解錠する。
3. 5分間操作がないと自動的に再ロックされる（設定変更可）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面構造 |
| `styles.css` | スタイル |
| `app.js` | 状態管理・一覧描画・編集フォーム |
| `crypto.js` | HKDF鍵導出／AES-GCM暗号化・キーラップ |
| `accesskey.js` | アクセスキーの生成・表示フォーマット・解析 |
| `qrcode.js` | QRコード生成（`vendor/qrcode-gen.lib.js` を使用） |
| `qrscan.js` | カメラ起動＋QR読み取り、画像ファイルからのQR読み取り（`vendor/jsqr.lib.js` を使用） |
| `storage.js` | `localStorage` の読み書き |
| `generator.js` | 登録アカウント用パスワードの生成・強度判定 |
| `vendor/qrcode-gen.lib.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT License） |
| `vendor/jsqr.lib.js` | [jsQR](https://github.com/cozmo/jsQR)（MIT License） |
| `manifest.json` / `sw.js` / `icons/` | PWA化（service workerはnetwork-first） |

## 対応ブラウザについて

QRコードの読み取りは `vendor/jsqr.lib.js`（純JS実装）でデコードするため、`getUserMedia`（カメラ）に対応していればSafari/iOSを含め幅広いブラウザでカメラスキャンが動作する。カメラが使えない環境や、画面に表示されたQRコードではなく保存済みの画像から読み込みたい場合は「画像からQRコードを読み込む」ボタンで端末のフォルダ／写真ライブラリから選択できる。どちらも使えない場合は手動貼り付け欄が常に利用可能。

## 注意

アクセスキーは主・予備どちらもアプリ内に保存されない。**両方とも紛失するとデータの復元手段は一切ない。** 詳細は設定画面の案内文を参照。

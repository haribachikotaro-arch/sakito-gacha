# SAKITO ガチャ

既存の画面・CSS・コイン演出・玉の物理処理を引き継いだ、Next.js App Router / React / TypeScript のプロジェクトです。

## 起動

Node.js 20.9以降が必要です。開発環境はNode.js 24を使用しています。
PowerShellでは実行ポリシーを変更せずに使えるよう、次のnpm.cmdコマンドを使ってください。

```powershell
npm.cmd install
npm.cmd run dev
```

ブラウザで http://localhost:4173/ を開きます。
以前のPythonサーバーが起動中なら、そのターミナルでCtrl+Cを押して終了してから実行してください。

引換券・音量の保存キーは従来と同じです。同じブラウザ・ホスト名・ポートで開くと、保存済みデータを引き継げます。ポイントは従来どおり再読み込みのたびに120 ptへ戻ります。

## 確認と本番起動

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

## 構成

- src/app/: ページ・共通レイアウト・元のCSS
- src/components/GachaGame.tsx: 元のHTML構造を引き継いだReactの画面部品
- src/lib/gacha/controller.ts: コイン、レバー、排出、開封、音、入力の制御
- src/lib/gacha/capsule-pile.ts: Canvasの玉の描画と衝突・攪拌の計算
- src/lib/gacha/types.ts: 操作状態・抽選結果・引換券の型
- src/lib/gacha/elements.ts: DOM参照の型と存在確認
- src/lib/gacha/preferences.ts: ブラウザへの保存と読み込み

画面はReactで表示し、毎フレーム変わるアニメーションとCanvasは専用コントローラーで更新します。Reactの再マウントや開発時のFast Refreshに備え、イベント・タイマー・音声・Canvasを終了時に後片付けします。

従来のwindow.SAKITO_DRAW_ENDPOINTによる抽選APIの接続口と、?debug=1 の確認用設定も維持しています。

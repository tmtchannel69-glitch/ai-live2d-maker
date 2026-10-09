# AI Live2D Maker

スマートフォン・PC で利用できるキャラクターパーツ準備用 Web アプリです。
Vite と Vanilla JavaScript で実装しています。

## 起動

Node.js 20.19 以上、または 22.12 以上を使用してください。この環境では Node.js 24 で確認しました。

```sh
cd /workspace/ai-live2d-maker
npm ci --cache /tmp/ai-live2d-npm-cache
npm run dev
```

## 基本操作

1. PNG・JPG・WebP の画像を選択、またはドロップします（最大 10 MB、各辺 4096 px 以下・1600 万画素以下）。
2. プレビューを確認して、髪・顔・体と衣装・目から対象を選択します。
3. 「パーツを分離する」を押すと、デモの切り出し結果が表示されます。
4. パーツ画像をタップすると拡大表示できます。「閉じる」または Escape キーで戻れます。
5. 各パーツの「PNG」で個別保存、「まとめて ZIP 保存」で表示中の全パーツを保存できます。
6. リセット、または画像の再選択で結果を消去します。

現在の分離は、元画像の決められた矩形領域を切り出すデモです。意味に基づく AI 分離、背景の除去、Live2D モデル生成はまだ実装していません。画像はブラウザ内で処理され、サーバーへ送信しません。

## AI 分離処理の接続

`src/separator.js` の `separateParts` を API 実装へ置き換えられます。画面はこのモジュールを通じて処理を呼び出します。

```js
// 入力
{ file: File, parts: ['hair', 'face', 'body', 'eyes'], signal: AbortSignal }
// 戻り値: Promise<Array<...>>
[{ id: 'hair', name: 'hair.png', blob: Blob }]
```

選択された ID ごとに PNG の Blob を返してください。画面側がプレビュー用 URL とダウンロードリンクを作成します。例外は画面上に表示され、再実行できます。画像の再選択・リセット時は AbortSignal で処理を中止します。API の認証情報はフロントエンドに置かず、バックエンド側で管理してください。

## 検証

```sh
npm run build
# 通常の開発環境では初回に実行
npx playwright install chromium
npm test
# このクラウド環境では既存 Chromium を使用
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test
```

ブラウザテストはモバイルのアップロード・プレビュー・選択分離・PNG 内容とサイズ・リセット・横幅、不正なファイルと未選択状態、PC の結果表示を検証します。Playwright が開発サーバーを起動します。

## 別の端末・Codex から開発を再開

基本画面の開発ブランチは `feature/parts-workflow` です。
スマートフォンの Codex でも、この GitHub リポジトリとブランチを選んでクラウドタスクを開始してください。
既存のチェックアウトがある場合はそれを使用し、明示的に必要な場合以外は Git worktree を作成しません。

新しい環境では依存関係と開発サーバーを準備します。

```sh
cd /workspace/ai-live2d-maker
npm ci --cache /tmp/ai-live2d-npm-cache
npm run dev -- --port 5173 --strictPort
```

GitHub にプッシュ済みのコードは、Windows PC の電源を切っても残ります。
開発サーバーのプロセスやアップロードした画像は GitHub には保存されません。
新しいタスクではサーバーを起動し直し、画像を再選択してください。
クラウドの localhost は Windows やスマートフォンの localhost とは別です。

Windows PC で起動する場合は、Node.js 24 LTS と Git を用意して PowerShell で次を実行します。

```powershell
git clone --branch feature/parts-workflow https://github.com/tmtchannel69-glitch/ai-live2d-maker.git
cd ai-live2d-maker
npm.cmd ci
npm.cmd run dev -- --port 5173 --strictPort
```

ターミナルを開いたまま、同じ Windows PC のブラウザで `http://localhost:5173` を開いてください。

画像が制限を超える場合は元画像を縮小して再選択してください。拒否された場合も前の画像と結果は保持します。対象の選択変更は次の分離に反映され、既存の結果は再実行するまで変わりません。

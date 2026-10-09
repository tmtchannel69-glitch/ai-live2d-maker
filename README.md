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

現在の分離は、元画像の決められた矩形領域を切り出すデモです。デモモードでは画像はブラウザ内で処理され、サーバーへ送信しません。点・枠で指定する AI 試作については下記の手順を参照してください。パーツ名の自動判定、隠れた部分の補完、Live2D モデル生成は未実装です。

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

最新の開発ブランチは `feature/prompted-segmentation` です。
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
git clone --branch feature/prompted-segmentation https://github.com/tmtchannel69-glitch/ai-live2d-maker.git
cd ai-live2d-maker
npm.cmd ci
npm.cmd run dev -- --port 5173 --strictPort
```

ターミナルを開いたまま、同じ Windows PC のブラウザで `http://localhost:5173` を開いてください。

画像が制限を超える場合は元画像を縮小して再選択してください。拒否された場合も前の画像と結果は保持します。対象の選択変更は次の分離に反映され、既存の結果は再実行するまで変わりません。

## AI 試作（点・枠で指定する切り抜き）

最新の試作ブランチは `feature/prompted-segmentation` です。デモモードの処理は引き続きブラウザ内です。
AI モードでは画像と点・枠をこのアプリの試作サーバーへ送り、CPU 上の SAM 2.1 で処理します。第三者 AI サービスへ送信しません。
認証や公開運用の対策は未実装なので、ローカル開発で使ってください。

Python 3.12 と Git を用意します。モデルと依存関係のダウンロードが必要です。GPU は不要です。

```sh
python3 scripts/setup_ai.py
# ターミナル 1: サーバーを起動（プロジェクトルートで実行）
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
# ターミナル 2: 画面を起動
npm ci --cache /tmp/ai-live2d-npm-cache
npm run dev -- --port 5173 --strictPort
```

Windows PowerShell の場合（Windows での AI 導入はまだ未検証）:

```powershell
py -3.12 scripts/setup_ai.py
# ターミナル 1
.\.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8000
# 別のターミナル 2
npm.cmd ci
npm.cmd run dev -- --port 5173 --strictPort
```

画像を選び、「処理方式」を「AI 試作」に変更します。選択パーツごとに「切り抜く場所を指定」で ＋ 残す点・− 除く点を置きます。点は各パーツ合計 32 個までで、枠と組み合わせられます。除く点だけでは実行できないため、残す点または枠を追加してください。数値入力と、パーツ別の「一つ戻す」「やり直す」にも対応します。

全体の分離後は結果カードの「髪を修正」などから指定を変更し、「このパーツを再分離」を押すとそのパーツだけ更新します。他の結果と、失敗した際の以前の結果は保持します。指定だけ変更した結果には「以前の結果」と表示します。PNG / ZIP は表示中の結果を保存するため、変更後の指定を反映したい場合は再分離してから保存してください。指定を消す操作は指定のみ消し、画像の再選択・リセットは全指定・履歴・結果を消します。作業の永続保存は未実装です。
出力は元画像と同じサイズの透明 PNG。隠れた部分は描き足しません。処理中のリセットは画面反映を止めますが、サーバーの計算自体は完了まで続きます。

モデル未配置の場合は `python3 scripts/download_sam.py` を実行してください。公式配布先 `dl.fbaipublicfiles.com` への通信許可が必要です。
`/api` は開発サーバーの転送機能を使います。`npm run preview` や単なる dist 配信では AI API 接続を提供しません。

[評価結果と限界](docs/AI_PROTOTYPE_RESULTS.md)、[候補比較](docs/AI_EVALUATION.md)も参照してください。

[複数点の実画像評価](docs/MULTIPOINT_EVALUATION.md)も参照してください。

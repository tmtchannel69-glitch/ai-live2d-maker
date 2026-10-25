# 画像1枚から頭・首・胴体を分けるアプリモード

2026-10-25。AI Live2D Makerの既存5パーツ経路を保ち、検証済みの`scripts/parts/rig.py --stage head`を呼ぶ別モードを追加した。点や枠の手動指定、パーツの手動配置、外部の画像APIは使わない。

## 再開元の確認

依頼された`0966e2e`とこの文書は、開始時の環境に存在しなかった。対象ブランチをGitHubから読み取り取得しても保存されていたのは`44b74d9ff3b4b2f8d718cd7d8d6619dd07b2b55b`で、0966e2eのobjectも未発見。したがって0966e2eの差分を調査・保持できたとは報告しない。

作業ツリーが未変更だったことを確認し、保存済み44b74d9からローカルの`feature/external-part-side-by-side-review`を復元。この環境にはなかった詳細モードの接続を、既存CLIと5パーツ生成器を再利用して実装・検証した。別環境にある未公開の0966e2eを置き換えたものではない。今回の変更はローカルコミットだけで保存し、push/main統合/公開はしない。

## 使い方と対応範囲

1. 「画像から変換」で、正面・両目と首が見えるアニメ調キャラクター1人の画像を選ぶ。
2. 「画像1枚から動くモデルを作る」のモードを「頭・首・胴体を分ける（実験）」へ変更する。
3. 「ローカル処理の準備状況を確認」で、必要なプログラム/重みの配置を確認する。この操作は画像なしでも使え、画像は送らない。
4. 生成ボタンを押すと、準備をもう一度確認した後にだけ、このアプリのローカルAPIへ元画像を送って一時処理する。
5. 完了後、`inochi2d-head-neck-body.zip`を保存する。ZIPの`model.inp`/`model.inx`をInochi Creator0.8.6で開く。

確認できたのは1枚の提供画像による**頭部中心の試作**。左右のまばたき、小さなHeadXの平面移動、HeadTiltのZ傾きを使う。胴体は固定。全身のリギング、顔の立体的な角度X/Y、口の動き、髪の物理や前後関係の正解、見えない形の正確な復元は完成していない。髪候補は頭に追従する範囲で、独立して自然に揺れる毛束の完成とはしない。

出力はInochi2D legacy0.8.6のINP/INX。Live2D Cubism/MOC3/VTube Studio互換の出力ではない。元画像が条件に合わない場合は失敗を表示し、固定ダミーや従来5パーツへの自動置換で詳細モード成功にしない。従来の5パーツは別の選択肢として残す。

処理中はモードの切替を止め、中止すると通信とサーバーの処理グループを終了させる。Linuxで子プロセスまで停止することを確認。Windowsの子プロセス終了は実機未確認。失敗/中止では編集データと前回のモデルZIPを保持する。モデルのラベル/保存名は生成時のモードを記録し、現在選択中のモードと混同しない。

## 詳細モードの準備

アプリは依存や重みを自動取得しない。準備確認はファイル/パッケージの存在を調べるだけで、大きな重みの読込・推論を行わない。モデルの正しいSHAは実処理時に検証し、不一致でも自動で取り直さない。

| 必要なもの | 配置/確認 |
| --- | --- |
| Python/基本依存 | Python3.12、`server/requirements-inochi.txt`の固定依存。OpenCV/NumPy/Pillow/ONNX Runtime/SciPy等 |
| SAM | CPU Torch2.5.1+cpu/torchvision0.20.1+cpu、SAM2 rev2b90b9f5ceec907a1c18123530e92e794ad901a4 |
| SAM重み | `.models/sam2.1_hiera_tiny.pt`、SHA7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69 |
| 顔検出 | `.models/animeface/lbpcascade_animeface.xml`、SHA9376d30ac38db6bda2a68b88b3b76bbd7e6aa33af47f7f5c76bc88ca75f1ce30 |
| 背景除去 | `.models/models/birefnet-general-lite/birefnet-general-lite.onnx`、SHA5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333 |
| JavaScript | 対応Node、package-lockの依存を`npm ci`で準備。fast-png/fflateを含む |

準備確認の応答には不足する項目名を入れ、画面にも表示する。SAMが不足していても、SAMを使わない従来5パーツの準備判定には影響させない。Creatorは出力後の別確認用で、アプリ生成の必須依存にはしていない。

依存の詳細は[元画像から再生成する手順](REPRODUCING_CHARACTER_RIG.md)も参照。`scripts/setup_ai.py`は依存導入の最後にSAM重み取得を行うスクリプトなので、今回自動実行しなかった。重みが手元にある場合は上表の位置に置く。公式の取得スクリプトを使う場合も、利用者が明示して実行する準備作業として扱う。起動や画像の選択が勝手に重みの取得を始めることはない。

準備済みの環境なら、2つのターミナルから起動する。

```sh
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

WindowsではPythonのパスを`.\.venv\Scripts\python.exe`へ置き換える。新モードのstatusにmodeが返らない古いAPIには画像を送らず、「更新して再起動」を案内する。

既存の別サーバーと競合する場合、この検証ではAPI8010/画面5180を使った。Viteの`AI_LIVE2D_API_PORT`はサーバー側のローカルポート設定で、外部ホストへは向けられない。

```sh
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8010
AI_LIVE2D_API_PORT=8010 npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

PowerShellの2つ目は`$env:AI_LIVE2D_API_PORT='8010'; npm run dev -- --host 127.0.0.1 --port 5180 --strictPort`。Windows/iPhone実機での確認ではない。クラウドのlocalhostはPCやiPhoneのlocalhostとは別で、ここに公開プレビューURLは作成していない。

## API・worker・ZIPの契約

- 従来：`GET /api/inochi2d/status`、`POST /api/inochi2d/generate`。既存の5役割と最小生成器をそのまま使う。
- 詳細：同じURLへ`?mode=detailed-head`。準備確認にscope/mode/不足項目/上限を返し、処理時間は最大600秒。workerは新しいPythonプロセスから、既存の`rig.py --stage head`を呼ぶ。CLI自体のアルゴリズムは変更せず、任意の`--error-report`だけを追加した。
- 同時生成は2経路共通のロックで1件。アップロード失敗/中止/例外でもロックと一時画像を片付ける。Unixでは親の終了後に残った子もプロセスグループで停止する。
- CLIのValueError/不足モデル/タイムアウトを構造化して渡し、400/413/415/422/503/504を画面へ返す。英語の顎/首検出失敗は日本語の再試行案内へ変換する。内部例外の詳細ログはローカルだけで、画面には一般的なエラーを出す。

| 制限 | 値 |
| --- | --- |
| 入力 | 10MiB、各辺4096px、1600万画素まで |
| 詳細worker/API | CLI540秒、API600秒、ローカルproxy660秒 |
| 作業領域の監視 | 256MiB/512ファイル、log2MiB |
| 生成モデルZIP | 圧縮後/展開後とも80MiB、最大256項目 |
| ブラウザ受信 | 最大80MiB。Content-Lengthなし/過少申告でもストリームを途中で停止 |

ZIPは最終graphが参照する生成PNG/マスクだけを採用する。元JPEG、`source-image`、一枚の再構成画像、未参照ファイル、CLI比較用PNGは含めない。モデル/共通parts/配置/補完根拠/診断JSON/provenance/説明書を含む。従来の**作業保存ZIP**は元画像を含む既存の再開形式で、ここでいう生成モデルZIPとは用途が異なる。

ファイル生成のレポートは`officialCreatorTested:false`/`appearanceQualityVerified:false`を維持する。特定のモデルSHAを公式Creatorで確認した結果は、別の[実画像検証記録](DETAILED_INOCHI_APP_MODE_VALIDATION.md)に保存し、他画像へ合格を流用しない。

## ローカルで再検証する

```sh
# 実際の画像をローカルブラウザ→APIへ送り、中止/再試行/ZIP/編集保持を検証
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/inochi2d/verify-app.mjs --source /path/to/original-character.jpg --output /tmp/NEW-app-check --url http://127.0.0.1:5180
# 元のCLIも維持。出力先は新しいGit外ディレクトリ
.venv/bin/python scripts/parts/rig.py --source /path/to/original-character.jpg --output /tmp/NEW-cli-head --stage head
.venv/bin/python -m pytest server -q
node --test scripts/model-build/test.mjs scripts/model-build/*.test.mjs scripts/inochi2d/*test.mjs scripts/character-generation/*test.mjs scripts/ai-image-pilot/*test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test
npm run build
```

同じ画像の再生成には元の入力ファイルが必要。今回の入力は以前の提供960×1280 JPEG、SHA`04a40e3ebcea23b4f6253eeaca12699df61fa70998a161ca6ce2733477304a4e`。既存の私用ZIPから新しいGit外フォルダへ取り出し、元ZIPは変更しなかった。入力/生成モデル/画面写真/ZIPをGitに追加しない。

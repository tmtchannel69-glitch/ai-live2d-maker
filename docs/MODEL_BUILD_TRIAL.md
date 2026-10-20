# PSDから実MOC3を生成するローカル試作

2026-10-20。素材からMOC3を生成できる新しい公開実装を実際に検証した。従来資料の「生成経路は未確認」は、この検証範囲で更新する。完全自動で自然な実キャラクターが完成することや、公式Cubism/VTube Studioでの互換性を保証するものではない。

## 確認したもの

| 検証 | 結果 |
|---|---|
| 自作10レイヤー128×192 PSD → 実MOC3 | 163,776 bytes、model3.json、512pxテクスチャ2枚、編集用cmo3を生成 |
| 同じ条件で再生成 | MOC3のSHA256が一致（下記） |
| 別実装のランタイム | モデル本体SHA256と検証報告の一致、整合性・復元・初期化・更新成功。12描画部品/433頂点/20パラメーター |
| パラメーターの実変化 | 顔XYZ、左右の目、口の開閉で頂点/透明度が変化。各パラメーターの最小/25/50/75%/最大で有限値とインデックス範囲を検査 |
| 実テクスチャを使った独立CPU描画 | 両目閉で1,596画素、口開で483画素が変化（256×384）。目視で閉眼/開口を確認 |
| このアプリの画面 → 素材送信 → 生成 → ZIP保存 | 自作11素材サンプルで成功。162,624 bytesのMOC3、13描画部品/728頂点。顔XYZ・左右の目・口の形状変化も確認 |
| 公式Cubism Core/VTube Studio実アプリ | 未実施 |
| 実AIキャラクターの自然さ・分離品質・隠れ部分生成 | この自作サンプル検証には含まない |

自作PSD由来MOC3 SHA256: `15b82eb202fa8f17f68ec7fa3054b451ec7a903ef9a038f5fc9105d290c41700`。
画像/生成物/取得ツールはGitへ保存しない。検証画像は今回の環境の `/tmp/ai-live2d-model-trial/independent-runtime-three-poses.png`、画面経由ZIP/報告は `/tmp/live2d-model-browser-SVeXc3/`。一時環境のファイルで、別環境への復元は保証しない。

## 外部ツールと利用条件

- 生成: [tsunehimatoi/psd2live](https://github.com/tsunehimatoi/psd2live)、SHA `2db3307373c9b7df69ca9a51aae9135ba52d131a`。アプリ/Umamo/Cubism出力は **GPL-3.0**。中立IR等の一部はMIT。公式SDKを含まない独立writer。別プロセスとしてローカル検証し、アプリへソースを取り込んだり配布したりしていない。公開/同梱/サービス運用前に条件と採用方針を確認する。
- 独立検証: [SakuraMotion/PurismCore](https://github.com/SakuraMotion/PurismCore)、SHA `1069334965522df5d0b791e97f01e26b19c45456`、**MIT**。公式Coreではない。別の実装で読めることの確認であり、VTube Studio互換の証明ではない。
- 初回JDKは公式Temurin21の配布SHA256を照合、Gradle9.6.1のwrapper.jar/配布zipも公式SHA256を照合。TLS検証を維持。SDKの規約同意、ソフト購入、有料API、利用者画像の第三者送信なし。

## 今のアプリで試す

現試作の生成サーバーはLinux環境専用。Windows/スマホは画面操作と生成されたモデルの読込を今後確認する対象で、生成サーバーをWindowsで動かす対応は含めない。開発用の生成サーバーを別に起動する。画像やモデルを公開する操作ではない。

```bash
cd /workspace/ai-live2d-maker
PSD2LIVE_BIN=/tmp/psd2live-cli \
PSD2LIVE_VALIDATOR_JSON='["python3","/workspace/ai-live2d-maker/scripts/model-build/validate-runtime.py","--library","/tmp/purismcore-validation/build/libPurismCore.so"]' \
node scripts/model-build/server.mjs
```

別セッションで `npm run dev -- --port 5173 --strictPort`。画面の「保存」→「Live2Dモデルを生成する（実験）」でサーバーを確認し、素材を準備して生成する。自作サンプルでも試せる。端末へ `ai-live2d-experimental-model.zip` が保存され、モデル一式と `AI_LIVE2D_BUILD_REPORT.json` が入る。公式Core/VTube Studio未確認の値を保持する。自己申告の「確認済み」は自動で付けない。

生成ツールが未設定なら画像を送らず、準備案内を出す。中止/リセット/画像変更で生成を中止し、遅い応答では保存しない。作業や原PNGを変更せず、続きを編集するには別途作業ZIPを保存する。

## 次の環境へツールを準備する

Node24、**コンパイラを含むJDK21（javac）**、Python3、Cコンパイラ/Makeが必要。JREだけではKotlinをビルドできない。ソースからの初回構築は数分・数GiBのメモリを使う。外部ソースの取得先/固定SHAとライセンスを確認し、既存のチェックアウトと変更を保持する。ツールを新しく用意する場合はアプリとは別の `/workspace/live2d-tools/` 等を使う。

今回実行したGradleの要点は以下。JDK/ネットワークプロキシは環境の正規設定を使い、TLSや配布チェックサム検証を無効にしない。

```text
./gradlew --no-daemon --max-workers=2 
  -Dorg.gradle.java.installations.auto-download=false
  -Ppsd2live.includeCubism=false -Ppsd2live.prebuiltRuntime=false
  -x buildRuntime -x fetchPrebuiltRuntime
  -I /workspace/ai-live2d-maker/scripts/model-build/classpath.gradle
  -PclasspathOutput=/path/to/compiler-classpath.txt
  classes jar writeModelClasspath
```

上は読みやすさのため改行した引数一覧。シェルでは一行または行継続で実行する。upstreamのGradle wrapper配布zip SHA256は `9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14`（Gradle9.6.1）。`PSD2LIVE_CLASSPATH_FILE` に作成したクラスパスファイル、`JAVA_HOME`にJDKを指定し、`PSD2LIVE_BIN` をこのアプリの実行可能な `scripts/model-build/cli.mjs` にすると直起動できる。JDKや依存jar、外部コンパイラをこのアプリのGitへ含めない。今回の `/tmp/psd2live-cli` は同じJavaクラスパスで直起動する一時ラッパーで、再生成のSHA一致まで確認済み。

PurismCoreは固定SHAの公開ソースを別フォルダーへ取得し `make -j2`。生成された `build/libPurismCore.so` を検証器の `--library` へ指定する。参照CC0モデルで検査器自体を先に確認した。共有ライブラリはコードを実行するため、利用者のアップロードをライブラリとして読み込まない。

## 入力と転写の制限

- 入力はアプリの制作引き継ぎZIP版1/2、100MiB以下、非圧縮エントリのみ。元画像や利用者メモは画面経由の生成用ZIPに含めない。基本/制作パーツが重複する場合は制作向けを優先する。位置のないデモは除外する。
- 元位置のAIパーツと、配置済みの表情素材を新しいPSDへ変換する。識別用の英語名を明示する。face_baseがあれば元の顔パーツに優先する。
- 開いた状態で表示される素材を使用。閉じた差分・非表示素材は今回は除外して警告する。まとまった目は白目/瞳/まつげへ自動細分化されない。
- アプリのメッシュ/表示範囲/親子キー/確認記録を移植しない。外部ツールが素材から新しい初期リグを作る。元の作業は作業ZIPで保持する。
- 表情素材の位置をPSDへ配置する段階は最近傍で拡縮する試作。展開画像量128MiB、出力100MiB、1ジョブ、生成/検証各180秒が上限。大画像の速度/メモリは未検証。
- サーバーは127.0.0.1:8001、Viteから専用経路で転送。生成に必要なPSD/出力はプライベート一時フォルダーで処理し、成功/失敗/中止後に削除する。プロセス強制終了やOS停止ではOSの一時領域整理が必要になる場合がある。第三者サービスは呼ばない。公開用認証/キュー/運用は未実装。

## 再検証

```bash
npm run build
node --test scripts/model-build/test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test -- --workers=2
# 自作10レイヤーPSDも再現可能（既存ファイルは上書きしない）
node scripts/model-build/create-fixture.mjs /tmp/new-model-fixture.psd
# Viteと実生成サーバーを起動後、自作サンプルだけで実変換
node scripts/model-build/verify-browser.mjs
```

通常のブラウザ試験のモデル応答は代替で、実MOC3の生成・有効性は判定しない。`verify-browser.mjs` は別に実CLIと独立ランタイムを使用して報告とZIPを `/tmp` に保存する。Windows/スマホのVTube Studio実読込、同時の複数パラメーター、物理、自然な品質、実AI画像での不足素材補完は今後検証する。

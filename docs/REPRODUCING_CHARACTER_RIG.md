# 元画像からモデル・検証画像を再生成する

2026-10-24。入力画像/モデル/検証PNG/ZIPはGitHubへ保存しない。開発コード、依存の固定、モデル重みの取得/検査、実行コマンドをGitに保存する。`/tmp`などのクラウド内データの永続保持は保証できないため、元画像はオーナーの端末にも保管する。

## 必要な入力と固定版

- 正面、両目を開いたアニメ調画像1枚。今回の実証は960×1280の銀髪・メイド服の提供JPEG。SHA256は`04a40e3ebcea23b4f6253eeaca12699df61fa70998a161ca6ce2733477304a4e`。このSHAは照合情報だけで、画像の代わりにはならない。以前の全身853×1280画像と区別する。
- 同じJPEGファイルを使用する。スクリーンショットや保存し直した画像は別入力となる。以前の私用約26MB ZIPを取得できた場合は`input/character.jpg`が今回の元JPEG。取得できなければ、オーナー保管の元添付が必要。
- Python 3.12、Node 20.19以上または22.12以上。実測版は各実行の`provenance.json`に記録する。
- `scripts/setup_ai.py`のCPU Torch2.5.1/torchvision0.20.1、SAM2ソースrev `2b90b9f5ceec907a1c18123530e92e794ad901a4`。Python依存は`server/requirements-inochi.txt`、JS依存は`package-lock.json`。
- SAM2.1 Hiera Tiny重みSHA `7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`。顔検出器は`download_animeface.py`、BiRefNet general lite ONNX SHA `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`。既存ダウンロードスクリプトが照合する。
- Inochi2D SDK v0.8.6 / `dda3a8f005f808104caa43183ab8753fb989e30f`、Creator0.8.6 / `371e5f4e21117102dbecc82371bfd9a6e2f5df02`。出力は旧INP/INX、INP2やCubism/VTube Studio対応ではない。

## Windows PCで準備・生成する

Git、Python3.12、対応Nodeを準備。GitHubの作業ブランチを取得する。次はPowerShellの例。保存先はリポジトリ外の新規フォルダを指定し、元JPEGは自分の端末から用意する。

```powershell
git clone --branch feature/head-neck-body-rig https://github.com/tmtchannel69-glitch/ai-live2d-maker.git
cd ai-live2d-maker
npm ci
py -3.12 scripts/setup_ai.py
.\.venv\Scripts\python.exe -m pip install -r server/requirements-inochi.txt
.\.venv\Scripts\python.exe scripts/download_inochi_models.py
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe scripts/parts/rig.py --source 'C:\Users\YOUR_NAME\Pictures\character.jpg' --output 'C:\Users\YOUR_NAME\Documents\inochi-head-trial'
```

これらは公開のプログラム/重みをダウンロードする初回準備。生成処理自体は画像を外部へ送らずCPUで実行する。Windowsのこの一連手順は実機未検証。依存配布元の通信拒否、対応Python wheel、SAMのビルドに関する問題は、その段階の失敗として扱う。LinuxとWindowsで全バイトが一致するとの保証はしない。

## クラウド/Linuxで同じ入力から生成する

```sh
python3.12 scripts/setup_ai.py
.venv/bin/python -m pip install -r server/requirements-inochi.txt
.venv/bin/python scripts/download_inochi_models.py
npm ci --cache /tmp/ai-live2d-npm-cache
.venv/bin/python scripts/parts/rig.py --source /path/to/original-character.jpg --output /tmp/NEW-head-rig-trial
```

出力先は既存フォルダを上書きしない。顔/顎/首の根拠が足りない場合は明示的に失敗し、ダミーモデルで成功としない。

| 出力 | 内容 |
|---|---|
| `common/parts.json`とPNG | 独立した観測役割/元座標/透明度/マスク/親子/補完の根拠 |
| `five-part/` | 既存5役割と変更していない最小生成器のモデル |
| `baseline/` | STEP 1の瞬きモデル。今回画像では元のSHA fee8d92…と比較する |
| `head/` | 頭/首/胴体を分けたモデル、配置、診断 |
| `neutral-reconstruction.png`、`independent-layers.png` | 観測の再構成とレイヤー比較 |
| `blink-quality/` | 実モデルを独立CPU描画した瞬き10状態と警告 |
| `head-quality/` | 頭の10状態、前後比較、首の穴/胴体固定/中立一致の診断 |
| `provenance.json`、`trial-report.json` | 入力/重み/モデルのSHA、コード版、依存、所要時間、別々の合否 |

CPU診断の比較画像は同じコマンドで再生成する。公式Creatorの画面写真は下記の別検証であり、CPU画像を公式の画面写真と呼ばない。髪の深度や推定補完の自然さ、まばたきの肌ぼけは未解決として残す。

## 頭部に加えて髪も生成する

同じ依存で`--stage hair`を指定する。これまでの出力も残し、毛束の独立操作版と公式物理版を別々に作る。Windowsでは上記のPython/画像/出力パスへ置き換える。

```sh
.venv/bin/python scripts/parts/rig.py --source /path/to/original-character.jpg --output /tmp/NEW-hair-rig-trial --stage hair
```

| 追加出力 | 内容 |
|---|---|
| `hair/` | 9候補の小さい変形、HairSway00〜08、モデル/配置/根元/制限/診断 |
| `hair-physics/` | 同じ変形に公式0.8.6のpendulumを接続した別モデル |
| `hair-quality/` | 実モデルの独立CPU描画25状態、比較/差分PNG、穴/固定胴体の検査 |
| `hair-blink-quality/` | 髪版モデルのまばたき10開度と品質警告 |

生成だけで`official_creator_passed`や`physics_official_runtime_passed`をtrueにしない。これらは下記GUIの別報告でモデルSHAごとに確認する。頭皮の根元、正しい前後関係、自然な完成品質、通常スマホ画面への接続は未完了。[設計](HAIR_RIG_DESIGN.md)、[実画像の検証](HAIR_RIG_VALIDATION.md)。

## 公式Creator 0.8.6での検証

Windowsでは[公式リリース](https://github.com/Inochi2D/inochi-creator/releases/tag/v0.8.6)の0.8.6を使用し、`head/model.inp`を開く。左右のEyeOpenL/R、HeadX/HeadTilt、組み合わせを確認し、別名INXへ保存してCreatorを終了、保存INXを新しいプロセスで開き直す。生成元のINP/INXは上書きしない。

Linuxの未改変公式バイナリは次の明示コマンドで固定SHAを照合して準備できる。`--archive`で既存の公式ZIPを指定すればオフラインで検査/展開する。

```sh
.venv/bin/python scripts/inochi2d/setup-creator.py --output /tmp/NEW-creator-086
```

X11/Xvfb、SDL2、Mesa、xdotool/libxdo3、D-Bus、ImageMagick、tesseract等が別途必要。既存クラウドの固定1280×960/英語/Nodes・Parameters配置、初回案内、100px広げたパラメータ欄は`INOCHI2D_CREATOR_CHECK.md`と`BLINK_RIG_VALIDATION.md`参照。`verify-creator.py`はこの配置専用で、画面の実表示値を照合してから撮影する。

```sh
.venv/bin/python scripts/inochi2d/verify-creator.py --source /path/to/original-character.jpg --manifest /tmp/NEW-head-rig-trial/head/model.layout.json --model /tmp/NEW-head-rig-trial/head/creator-working.inx --output /tmp/NEW-head-first-audit --xdotool /path/to/xdotool --display :94 --quality --transitions --controller-extra-width 100
```

生成モデルを`creator-working.inx`へコピーしてGUIで開いた後に実行。保存後、新プロセスで同じINXを開いて別出力先と`--compare /tmp/NEW-head-first-audit`で再検証する。保存されたモデルの全描画PartのRGBA保持は`check-creator-save.py`で別確認する。生成成功/公式互換/見た目の合格を分け、任意画像を一律に検証済みとしない。

キー入力の取りこぼしを保存成功としないため、最初の案内を通常どおり閉じた後、次の補助コマンドでCtrl+Sを保持入力し、ファイルの実更新を確認できる。元の生成ファイルと同じパスは拒否する。

```sh
.venv/bin/python scripts/inochi2d/save-creator.py --working /tmp/NEW-head-rig-trial/head/creator-working.inx --generated /tmp/NEW-head-rig-trial/head/model.inp --output /tmp/NEW-save-confirmation.json --xdotool /path/to/xdotool --display :94
```

```sh
.venv/bin/python scripts/inochi2d/check-creator-save.py --generated /tmp/NEW-head-rig-trial/head/model.inp --saved /tmp/NEW-head-rig-trial/head/creator-working.inx --output /tmp/NEW-texture-retention.json
.venv/bin/python scripts/inochi2d/check-rig-retention.py --generated /tmp/NEW-head-rig-trial/head/model.inp --saved /tmp/NEW-head-rig-trial/head/creator-working.inx --output /tmp/NEW-structure-retention.json
```

構造検査は親子/元位置/mesh/マスク/閾値/パラメータの対象とキーを別照合する。公式保存のfloat32丸めは最大1e-4まで許容し、変更した親や閾値/キーを見逃さない負例テストを持つ。この構造検査だけを公式での動作確認や自然さの合格としない。

### 髪モデルの公式GUI検証

髪版を`save-creator.py`で保存するときは、ソフトウェア描画の負荷に合わせて`--input-delay-scale 2.5`を追加できる。実際のファイル更新を確認する条件は同じ。

`hair/model.inx`を`hair-working.inx`へコピーして公式GUIで開く。パラメータ数が増えてスクロールバーが出るため、従来26状態へ`--parameter-scrollbar-width 14 --input-delay-scale 2.5`を追加する。他の引数は頭部の例の`head/`を`hair/`へ置き換え、`--output /tmp/NEW-hair-first-audit`へ保存する。フィルターは空にし、リスト先頭・既定の展開状態を使う。記録の許容誤差は緩めない。

次に同じモデルで各毛束を検査する。

```sh
.venv/bin/python scripts/inochi2d/verify-hair-creator.py --model /tmp/NEW-hair-rig-trial/hair/hair-working.inx --manifest /tmp/NEW-hair-rig-trial/hair/model.layout.json --reference /tmp/NEW-hair-first-audit/creator-report.json --output /tmp/NEW-hair-strands-first --xdotool /path/to/xdotool --display :94
```

公式で実保存した後、Creatorを終了し、保存したINXを新プロセスで開く。26状態を`--compare /tmp/NEW-hair-first-audit`で確認。その新しい`creator-report.json`をreferenceにして、毛束検査を別出力先へ`--compare /tmp/NEW-hair-strands-first`で実行する。referenceのSHAと開いているモデルが一致しなければ拒否する。保存前後のテクスチャ/構造も上の2コマンドで検査する。

物理版は同時に開かず、別の`hair-physics/physics-working.inx`を作って公式の新プロセスで開く。通常の初回案内を閉じ、同じ100px広げたパラメータ欄で次を実行する。

```sh
.venv/bin/python scripts/inochi2d/verify-hair-physics.py --model /tmp/NEW-hair-rig-trial/hair-physics/physics-working.inx --manifest /tmp/NEW-hair-rig-trial/hair-physics/model.layout.json --reference /tmp/NEW-hair-first-audit/creator-report.json --output /tmp/NEW-native-physics-first --xdotool /path/to/xdotool --display :94
```

referenceは同じ入力/配置の静的モデルによる画面領域の照合用。物理モデル自身のSHA/実時刻/表示値/画面/停止/揺れ戻し/減衰/胴体固定は別に記録する。物理版も実保存→新プロセス再読込→別出力先で同じ検査を行い、2種類の保存検査を実行する。時間列は実際のGUI時間に従うため、異なる実行で動画画素や時刻が完全一致するとの保証はしない。Pythonの独立描画は物理を実行しない。

PCからこのクラウド内ファイルを取得できるかは別の接続機能の問題。取得経路の完成を前提にせず、元画像とGitHubのコードからPC側で再生成する経路を維持する。既存約26MB ZIPは変更せず保持し、素材をGitHubへ上げない。

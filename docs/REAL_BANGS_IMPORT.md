# 実際の前髪PNGを自動配置する（STEP5）

対象はオーナーが添付したラベンダー色の前髪。元画像のSHA256は `3f8ffe587827435e663432c4b8fd562969985c89239726cbbc6892f6477960cd`、1,185,201bytes、1254×1254pxの8bit RGBA PNG。実際に画像を開き、色/alphaと毛先を確認した。由来は「ChatGPT生成」とのオーナー申告であり、認証済みのAI出典としては記録しない。**実画像は前髪1枚、他の32枚は既存テンプレート**である。

[最終の動作・品質・残課題](REAL_BANGS_VALIDATION.md)を参照。画像/モデル/ZIPはGitに追加しない。

## アプリで使う

1. 上部の「キャラクター制作」で女性ベースを組み立てる。
2. 「生成した前髪PNGを自動で合わせる」を開き、前髪の透過PNGを1枚選ぶ。日本語や生成サービスの任意ファイル名でよく、手動で点・枠・支点を指定しない。選択だけでは読み込み/装着を始めない。
3. 「前髪を自動配置して装着」を押す。端末内でalpha検査と配置候補比較を行う。API/SAM/モデル重みは不要で、画像を第三者へ送信しない。
4. 目/口/頭/呼吸を操作して確認する。「ひとつ前の交換に戻す」か「前髪を基準に戻す」で元へ戻せる。他の32パーツ・操作中のposeは維持する。
5. 「前後と動作の比較ZIPを保存」で、通常前後/左右比較/12状態の前後比較/元PNG/処理PNG/配置PNG/検証JSON/再生成依頼文を保存する。元PNGは入力が残るセッションだけに含め、再開後に存在しない入力を含むと偽らない。
6. 制作を続ける場合は別に「制作ZIPを保存」。正規化した33PNGと元に戻す基準33PNG・INP/INX・pose/履歴を保存する。「制作を再開」から読み込み、同じモデルを再計算できる。

比較は独立Canvas描画で、公式SDK/Creatorの画面ではない。明示操作による瞬きと呼吸の再生はアプリの共通制御で、書き出したモデルに時間駆動の自動呼吸を追加したものではない。モデル形式はInochi2D legacy0.8.6で、Cubism/MOC3/VTube Studio互換ではない。

## プログラム側の処理

- 入力は64〜2048px/8MiB以下、8bit RGBA。全背景が不透明/空/重要な毛先候補が画像端へ接触する場合は失敗にする。
- alpha8以上の全画素はRGB/alphaをそのまま残す。近傍2pxにもalpha8以上の画素がないalpha1〜7の背景だけを取り除く。原画の色・陰影を描き直さず、alphaの一律増強・輪郭の浸食・欠損の架空補完はしない。強い白縁/誤った髪の形は自動で消せたとしない。
- 透明余白を除くboundsから**同一倍率**で縮小する。拡大はしない。基準に対する6倍率×7位置を試し、現在の目・眉のPNGと白目clipを使って重なりを測る。瞳4%/白目22%/眉50%という暫定の構造的な上限を超える候補を採用しない。これらは自然さの正解確率ではない。
- 元の前髪maskとの被覆と目・眉の重なりで候補を選ぶ。適合候補がなければ明示失敗し、ダミーで置換しない。手動の画像固有座標は使用しない。
- `bangs_front`だけ配置領域を拡張する。親`group_hair`→`group_head`と支点/順序を維持し、新しいPNG寸法から既存の3×3meshを作り直す。元の7制御と他の32PNGは変えない。
- `character_manifest.json`の`assembly_extension`が、厳密なcanonical blueprintとの差を明示する。基準へ戻したときに元の設計へ完全一致しなければ受理しない。他役割の座標/親/支点/順序を書き換える迂回路にはしない。
- manifestのgenerator/part.generationは**基準設計の参照**である。外部PNGの生成元・欠損補完・完全な隠れた形の証明ではない。実素材の由来/SHA/配置はassembly_manifestとmaker_projectに記録する。

今回の自動選択は、元の前髪rect `[185,102,398,237]`から`[159,42,450,445]`へ拡張。透明余白を除いた1074×1060pxを約41.527%で446×440.186pxへ縮小し、2px余白を置く。支点は`[384,137.7]`、order200。実画像を縦横別々に引き伸ばす方式ではない。操作後に目パーツを交換した場合は重なりを再確認する。画面の値は装着時の測定である。

## 保存形式と互換性

| 対象 | 形式 |
| --- | --- |
| 従来の33パーツ基準/設計 | 元のv1/v2を維持 |
| 配置拡張した33パーツ | v2の基準blueprint＋明示assembly_extension。新しい専用validator/adapterで処理 |
| 従来の制作ZIP | maker_project version1を引き続き読める・出せる |
| 前髪配置を拡張した制作ZIP | maker_project version2。canonicalなbaseline_manifestとassembly_extensionを別保存 |
| 動作モデル | 既存Inochi2D legacy0.8.6、33texture/41node/7params/28bindings |

旧0318465以前のアプリは新しい制作ZIPを未対応として拒否する。先にこのブランチを更新する。新コードで旧プロジェクトの内容を勝手に変更しない。旧6制御の生成器/5パーツ/詳細画像処理は維持し、`buildPlacedInochi`というopt-in入口で既存builderを再利用する。

## コード

- `shared/bangs-image.js`：元の強い画素を変えないalpha処理。
- `shared/bangs-placement.js`：前髪だけの配置拡張/基準の厳密検証。
- `shared/bangs-preparation.js`：保存済みの由来/数値を検査し、未検証の値で画面が壊れないようにする。
- `src/character-maker/bangs-import.js`：実PNG→候補比較→既存交換/組み立て/モデル化。
- `src/character-maker/bangs-review.js` / `bangs-prompt.js`：実モデル設定から比較画像/ZIP/具体的な再生成依頼文を端末へ出力。送信はしない。
- `project.js` / `archive.js` / `panel.js`：失敗・中止で旧制作を保持、undo/基準復帰、v1/v2再開、スマホの入口。
- `shared/generated-character-inochi.js`：旧builderを呼ぶ新opt-in入口だけを追加。`modular-character-rig.js`はこの入口を明示選択。

## 同じ実画像から再現する

元PNGはGitにない。オーナーの元ファイルをPNGのまま保存する。画像を用意できない場合、以下のスクリプトは失敗し、代替素材で成功扱いしない。

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

別ターミナルで実行する。出力の親ディレクトリは既に存在し、出力先自体は未作成でGit外でなければならない。既存のファイルは上書きしない。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/character-maker/real-bangs-trial.mjs --source /path/to/owner-bangs.png --output /tmp/NEW-real-bangs --url http://127.0.0.1:5173 --expected-sha 3f8ffe587827435e663432c4b8fd562969985c89239726cbbc6892f6477960cd
```

Node24.19.0/fast-png8.0.0/fflate0.8.3/Chromium151で検証。ブラウザ未導入ならPlaywrightの既存手順で準備する。スクリプトはブラウザや画像モデル重みを勝手にダウンロードしない。Windowsは`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`を実在するChromeへ別行で設定し、source/outputをWindowsのパスに置換する。異なる画像を試すならexpected-shaを省略できるが、今回の公式・品質検証を流用しない。

これでbase/attachedの制作ZIP・個別PNG/JSON/INP/INX、元PNG、比較ZIP/PNG/依頼文、スマホ幅画面、操作結果を出す。SHAと他32PNG/7制御の不変、取り消し/基準復帰/再開/外部リクエスト0も検査する。

Pythonの既存依存と固定Creatorを持つLinux環境では追加検証できる。

```sh
.venv/bin/python scripts/character-generation/render-inochi.py --input /tmp/NEW-real-bangs/attached --output /tmp/NEW-real-bangs-cpu
.venv/bin/python scripts/character-maker/audit-real-bangs.py --input /tmp/NEW-real-bangs --output /tmp/NEW-real-bangs-audit.json
.venv/bin/python scripts/character-generation/creator-trial.py --input /tmp/NEW-real-bangs --output /tmp/NEW-real-bangs-official --creator /path/to/pinned-0.8.6/inochi-creator --runtime /path/to/private-runtime --xdotool /path/to/xdotool --display :96 --names attached --include-breath
```

Creator/SDKは既存の0.8.6固定版と[GUI手順](INOCHI2D_CREATOR_CHECK.md)を再利用する。通常のアプリ利用にPython/Creatorは必須ではない。

## iPhoneでの受け取りについて

アプリ内の「前後と動作の比較ZIPを保存」は端末内でZIPを作る。保存できたZIPをiPhoneの「ファイル」でタップして展開し、side_by_side.pngやmotion/内のPNGを開く。実iPhone/Safariでのダウンロードは未検証で、今回の操作はChromiumの390pxタッチ設定で確認した。

今回のCodex環境には、回答へZIPを添付したり認証付き共有URLを発行するツールがない。**クラウド内の/tmpパスやlocalhostをiPhone用ダウンロードリンクとして案内しない。** 外部Driveへの転送/公開アップロードも実行していない。比較画像の会話内表示とクラウド内の保管はできるが、iPhoneへのZIP実データの直接受け渡し完了とはしない。

PCを使える時は、この開発ブランチのコードとオーナーの元PNGから上の手順またはアプリで同じ成果物を生成・保存できる。クラウド/tmpの存続は保証されないため、元PNGと作業ZIPを本人が保管する。公開GitHubに画像やモデルを置く必要はない。

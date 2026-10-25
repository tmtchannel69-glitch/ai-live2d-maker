# 交換式33パーツ・キャラクターメーカー

2026-10-25。主方式を「独立したパーツを組み立て、交換して使う」へ進める。AImyの素材/キャラクターの複製はせず、既存の自作テンプレートとユーザーが用意する独立PNGを使う。画像1枚からの変換/詳細Inochi2D出力は別モードで保持する。

## 再開元とSTEP 1

GitHubの最新headsを読み取り確認した。

| branch | commit | 役割 |
| --- | --- | --- |
| main | f38395c | 開発成果の基準には使わない |
| feature/part-first-character-generation | 08c0edd | 33部品/共通設計/自動リギングの旧保存点 |
| feature/automatic-inochi-character | 50390a8 | 画像1枚からの自動生成の旧保存点 |
| feature/external-part-side-by-side-review | 44b74d9 | 外部PNGの単体/一括実験 |
| feature/portrait-region-proposals | 71976bb | ZIP33枚/画像監査/領域提案の追加成果 |
| ローカル最新 | 2986c7c | 詳細アプリ/結果確認/肌境界補正を含む |

未変更の2986c7cから`feature/modular-character-maker`を作成。71976bbをmergeして、双方の成果と研究を保持した。Viteの競合は、詳細APIのport/timeoutとPSD依存の事前最適化を両方残して解決。main/既存branchは変更しない。

調査で分かった不足は、外部PNGが「基準とは別の一度限りの実験結果」になり、交換を重ねた現在のキャラクター/履歴/共通動作を一つのプロジェクトとして保存できないこと。旧manifestの生成元は基準テンプレートのままで、外部PNGの由来は別レポートにある。新方式ではこの区別を明確に保持して改善する。

STEP1検証：変更前の全Node178件/build成功。両branchを保持した後、関連Node113件、33生成/設計/リギング/外部PNG・ZIPのブラウザ27件、build成功。テンプレートによる検査で、本物のChatGPT画像の品質成功ではない。

## STEP 2〜4の実装範囲

1. 独立した交換プロジェクト/データ構造を追加する。基準の33manifest版1/2を変更せず、現在の33PNG、役割別の由来/指紋/履歴、共通動作を管理する。
2. 既存PNG/ZIPの検査と組み立てを再利用する。安全な役割照合、配置/支点による正規化、左右と透明度/範囲/寸法を検査。失敗/中止で前の作業を保持する。
3. 前髪/目/衣装の交換を重ね、完成プレビューと個別PNG、プロジェクトZIP、Inochi2Dモデルを保存/再開できるようにする。構造上の重大な異常は完成出力にしない。
4. 既存の左右瞬き/口/HeadX/Y/Tiltを再利用し、交換でパラメータ設定を消さない。共通動作とパーツ固有の形を分け、限定した呼吸の動きも検討する。独立した画面描画と公式Creatorでの検証を区別する。

保存/テンプレート/交換は端末内で行い、外部AIへの送信や有料APIは実行しない。実AIの出典と品質は未確認のまま保持する。本物のChatGPT素材は今回未提供なので、STEP6の実用性確認は保留して理由を記録する。将来APIは共通参照/統一設計を使う方式とし、33回の無関係な生成にはしない。

新指示は作業ブランチへのpushを明示的に承認している。前段のローカルのみという指示より今回を優先する。画像/モデル/ZIPはGitへ追加せず、main統合・アプリ公開は行わない。

## 実装した共通データと取り込み

- `src/character-maker/project.js`は現在の33PNGと、元に戻すための基準33PNGを別々に保持する。交換は候補Mapで全検査/合成/モデル生成が終わった後だけ反映し、前の交換・7動作値・基準を消さない。最大10回の一時undoと100件の交換履歴を持つ。
- 役割照合は`shared/modular-character.js`。本人左右を固定し、`front_hair.png`→`bangs_front`など明確な別名だけに対応。`eye_l.png`のような全目画像を虹彩などへ推測して割り当てない。
- 旧`inspectExternalPartPng`/compositor/Inochi生成器を再利用。RGBA8/空/透明度/寸法/範囲/合計サイズを検査。基準crop、配置済み768×1024、左右128px余白の1024×1024に対応。切り抜きPNGは全バイト保持し、配置済み画像は復号RGBAを直接cropする。Canvas経由の色丸めを保存PNGへ混ぜない。
- 現行の基準33manifest v1/v2と支点・順序・親子・clipを維持する。v1は標準配置、v2は設計から再検証した配置に限定。任意の新しい人体座標/画風/衣装形状の自動推定が完成したものではない。
- 重要役割の極端な描画不足、虹彩が白目外、左右白目の著しいサイズ差、首の接続stemの透明な穴を拒否する。画素warningは表示するが、色・線・隠れ面・自然さを正しいと断言しない。新リグのmesh検査は各単一制御区間の面積二次式の最小値と複数制御の軸点/辺を検査し、全3次元内部の無欠陥証明とは区別する。
- ZIP上限：部品は圧縮16 MiB/33PNG合計12 MiB。制作は圧縮/展開48 MiB/128entry。共通bounded readerで事前索引と小刻みな実展開量・重複・パスを検査し、外部ZIPのスクリプト/保存model JSONは実行しない。旧詳細モデルZIPの80 MiB/256entry入口は維持する。

### 制作ZIPの版1

`maker_project.json`のformatは`ai-live2d-modular-character-project`。現在/基準の33役割のSHA256・由来、基準manifest、pose、交換履歴、リグprofileを記録する。

| ファイル | 内容 |
| --- | --- |
| `parts/<role>.png` | 現在の独立33PNG |
| `base/parts/<role>.png` | 元に戻す基準33PNG |
| `preview.png` | 現在の通常姿勢の合成PNG |
| `character_manifest.json` | 基準の配置/デザイン。実素材のAI出典を保証しない |
| `assembly_manifest.json` | 役割/rect/anchor/parent/order/clipと現在の由来 |
| `rig_metadata.json` / `inochi_model.json` / `inochi_report.json` | 実モデルのmesh・binding・検査/制限 |
| `character.inp` / `character.inx` | Inochi2D legacy0.8.6。Cubism/MOC3ではない |
| `assembly_quality.json` | 構造と画素検査。完成品質/公式動作の自動合格はfalse |

再開時はPNG/指紋/履歴/基準を検査し、PNGから合成とリグを再計算する。ZIP内のモデルを任意のランタイムへ実行しない。旧テンプレート/デザイン指定の33パーツZIPも読み込める。画像1枚からの作業/詳細モデルZIPは旧画面の別入口を使う。

## 画面の使い方（STEP3〜4）

1. アプリの最初に「キャラクター制作」が開く。髪型/色・目の形/色を選び「ベースを組み立てる」。自作の端末内描画でありAI生成ではない。
2. 前髪/目/衣装の別テンプレートを順番に試す。交換を重ねても他のパーツは残る。「ひとつ前の交換に戻す」と、指定範囲だけ基準へ戻す操作がある。
3. 外部素材は折りたたみ欄を開き「共通参考画像と配置ガイドを保存」。共通デザイン/参考画像/33役割の寸法・位置・支点・親・順と依頼条件を端末へ保存する。ChatGPTへの自動送信はしない。無関係な33回生成やシート1枚を独立パーツの成功にしない。
4. PNG複数か部品ZIPを選択し、照合結果を見て「確認して交換」。選んだだけでは交換しない。適合しない場合は役割・理由・必要寸法を表示し、前の制作を保持する。
5. 左右別の瞬き/口/頭X/Y/傾き/呼吸のスライダーで確認する。本人左目は画面右。共通の動作名/範囲を維持し、実際の白目/まつ毛PNGから目曲線/meshのbindingを再計算する。手動リギングは不要。
6. 「瞬きと呼吸を再生」は明示操作で開始し、停止/モード変更/タブ非表示/新処理で止めて元のposeへ戻る。保存は通常姿勢の完成PNGと、操作していたposeの制作プロジェクトを区別する。
7. 制作ZIP/完成PNG/個別PNG/INP/INXを端末へ保存。次回は「制作を再開」で制作ZIPを開く。基準PNGも含むので再開後も元に戻せる。一時undoは画面内10回だけで、再開後は空になる。

新モードは`src/character-maker/`に分離。旧2モードはDOM/状態/操作と旧保存形式を保持し、上部から往復できる。直接開く場合は`?mode=maker`（既定）/`?mode=generate`（従来パーツ）/`?mode=convert`（画像変換）。既存ブラウザ試験は入口だけ`?mode=convert`へ変更して、画像変換の既存検査内容を残している。

### 動作とプレビューの範囲

`shared/modular-character-rig.js`は既存の6制御生成器をそのまま呼び、独立したprofile `modular-character-rig-v1`で小さな胴体Breath制御を追加する。元のv1/v2出力器、5パーツ/詳細画像処理は変更しない。旧6制御の出力に呼吸を混入させない。

- EyeOpenL/R、MouthOpenは独立。HeadX/Yは小さな平面移動、HeadTiltはZ回転。頭の制御では胴体/襟を固定し、首は既存の連続変形を再利用する。顔の立体角度ではない。
- Breathは胴体グループへごく小さな拡大/上下変化を加え、子の首/頭も同じ変換へ追従する。軸点0/.5/1。公式GUIでShift操作が端へ吸着する問題を見つけ、中間キーを追加した。自動のネイティブ呼吸automationではなく、共通制御を提供する。
- `preview.js`は**実際に格納したモデルJSON/PNGとbinding**を評価する限定Canvas描画器。Normal/1D線形/既知のmask/meshを扱い、他の任意INP/INP2を開く公式SDKではない。Inox2Dの0/opacity不具合には変更を加えない。
- 共通の7制御と、役割別の位置/支点/階層、素材から再測定する固有の変形情報を分ける。今の基準配置を外れた大幅な髪型・衣装や物理設定の自動推定は後段。

## PC/クラウドでの復元と再生成

```sh
git clone --branch feature/modular-character-maker https://github.com/tmtchannel69-glitch/ai-live2d-maker.git
cd ai-live2d-maker
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

端末自身のブラウザで`http://localhost:5173`を開く。新モードはSAM/Python/重み/APIキーなしに利用できる。クラウドのlocalhostとPC/iPhoneのlocalhostは別物。公開URLの作成は今回の範囲外で、iPhone実機/Safariは未検証。

別ターミナルから自作テンプレートの基準→前髪→目→衣装の累積4段階と、動作画面・制作ZIP再開を再生成できる。

```sh
# Playwright Chromiumが既にある環境。システムChromeなら実在するパスを指定。
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/character-maker/trial.mjs --url http://127.0.0.1:5173 --output /tmp/NEW-private-maker-trial
node --test scripts/character-maker/test.mjs scripts/inochi2d/app-review-test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/modular-character-maker.spec.js --workers=1
npm run build
```

Windows PowerShellは環境変数を`$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\...\chrome.exe'`のように別行で指定する。パスを未指定ならPlaywrightの既存ブラウザを使う。ブラウザ未導入なら`npx playwright install chromium`が必要で、これは画像処理モデル重みとは別の開発依存。自動取得はスクリプトへ入れていない。

`trial.mjs`はGit外の**新規ディレクトリ**だけに保存し、既存データを上書きせず、local origin以外とAPIを遮断する。base/bangs/eyes/outfitにはproject.zip/PNG/manifest/INP/INX/動作画面と実測が入る。元画像は不要。外部PNGの再現にはその素材をオーナー自身で保管するか、制作ZIP（基準/現在PNGを含む）を保持する必要がある。クラウドの/tmpの存続は保証されない。

既存Python依存と固定公式バイナリがあるLinux環境では、CPU/公式GUI検証も再実行できる。Creator監査は固定1280×960の既存レイアウト/通常通知の終了を必要とし、通常のアプリ利用には不要。

```sh
.venv/bin/python scripts/character-generation/render-inochi.py --input /tmp/NEW-private-maker-trial/outfit --output /tmp/NEW-private-cpu
.venv/bin/python scripts/character-generation/creator-trial.py --input /tmp/NEW-private-maker-trial --output /tmp/NEW-private-official --creator /path/to/pinned-0.8.6/inochi-creator --runtime /path/to/private-runtime --xdotool /path/to/xdotool --display :96 --names base,outfit --include-breath
```

公式Creator0.8.6 LinuxバイナリSHA256は`2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc`。SDK/形式の固定は旧生成器の`GENERATED_INOCHI_PIN`を再利用する。新しい外部ライブラリ/API/有料契約/他社素材は追加していない。GUI用レイアウトや依存は[既存手順](INOCHI2D_CREATOR_CHECK.md)を参照。

## 未完成と次の優先課題

- 本物のChatGPT生成独立PNGは未提供。実AIのデザイン一致・高品質・権利/出典・隠れた面・異なる画風での成功率は未評価。
- 現在は基準の正面/胸上/メイド服の33構造へ適合する交換。任意の服・長さ/形状を完全自動で再認識する機能は未完成。自動推測で違う役割に割り当てない。
- 低開度のまぶた/まつ毛の線、開口の切り替え、首影、公式描画と合成PNGの表示差をSTEP5で優先。構造検査だけで完成品質へ昇格させない。
- 髪/服の物理、視線/表情/会話反応、実iPhone/Safari、公式ブラウザランタイムは後段。Cubism/MOC3/VTube Studio互換とは表示しない。
- 直接AI APIの接続は既存の未送信準備を再利用できるが、最新のサービス/モデル/料金/ライセンス/送信する参照/最大費用と承認が必要。今回の送信/課金は0。

最終の検査結果・公式Creator・品質の別判定は[検証記録](MODULAR_CHARACTER_MAKER_VALIDATION.md)を参照。制作状態/中止欄をスマホで追従表示し、長い品質注記はプレビューを隠さない位置へ分けた。再生成先は実在する親のsymlinkも解決し、Git外の新規ディレクトリに限る。

# 33パーツからのInochi2D自動モデリングと再現手順

2026-10-24。基準`feature/part-first-character-generation`/`f107b71`から同じ作業ブランチで拡張。[実装前の整理](PART_FIRST_INOCHI_DESIGN.md)。AIパーツ生成、有料契約、画像の外部送信、公開、main統合は行っていない。

## 実装した範囲

新モードでテンプレートを選んで一度生成すると、独立した33PNGの描画→自動組み立て→Inochi2Dの動作設定→INP/INX保存まで行う。入力画像、手動の点/枠、手動リギングは不要。配色を変えられる端末内のテンプレートであり、AI自由生成ではない。

| 項目 | 設定 |
| --- | --- |
| 形式 | legacy INP/INX、Inochi2D SDK / Creator 0.8.6固定、INP2対象外 |
| 形状 | 正面・胸上・女の子・メイド服、768×1024 |
| 元素材 | 完全な重なりを持つ独立33PNG。元PNG/alpha/座標は不変 |
| 構造 | 8グループ＋33Part、Root→Body→Neck→Head。元ID `root`のnative表示名は`Root` |
| メッシュ | 1,259頂点、1,872三角形。目/まぶた/まつ毛17×7、首7×13、ほか3×3 |
| テクスチャ | 33枚、展開RGBA合計7,036,208 bytes。格納用だけpreclipとfloor(RGB×alpha/255) |
| 左右のまばたき | `EyeOpenL/R`、本人左右、0=閉眼/1=開眼。白目を縮め、虹彩/反射をマスク、まつ毛の厚みを保持して移動 |
| 口 | `MouthOpen`、0=元の通常口/1=口内。目と独立。途中は通常線の減衰と口内の縦変形 |
| 頭 | `HeadX` ±8px、`HeadY` ±4px、`HeadTilt` ±0.025rad。首だけ連続変形、胴体/服/襟/リボンは固定 |
| 動作キー | 6パラメータ/25bindings、線形補間。目は0/.025/.075/.15/.25/.5/.75/1 |

目の輪郭は実際に生成した白目/まつ毛PNGから滑らかな曲線を推定する。閉眼時は顔の完全な肌レイヤーが見える。単一の完成顔を潰して動作成功にしていない。配置確認用の図形は解剖的なモデルにはせず、元の静止39項目を出力する。

頭の動きは平面移動とZ回転であり、顔の立体的なyaw/pitchではない。新モードに髪の物理演算/追跡は含めていない。Cubism/VTube Studio互換も含めない。

## 保存するファイル

元の39項目（完成PNG/33PNG/character manifest/静止rig/中間データ/recipe/説明）へ、次の6項目を追加した45項目のZIPを作る。

- `character.inp`、`character.inx`：約1.02MBずつ。同じlegacy runtimeコンテナ。公式Creatorで再保存できる。
- `inochi_model.json`：格納した実ノード/mesh/マスク/parameter/binding。
- `inochi_rig.json`：元座標/支点/親子と実際のmesh/キー。
- `inochi_report.json`：固定版、生成設定、処理内容と制限。任意の新出力を一律公式合格にせず`official_creator_tested:false`を維持。
- `INOCHI2D.txt`：パラメータと元の静止仕様との区別。

元の`character_manifest.json`/`rig_metadata.json`/`inochi_intermediate.json`は静止素材の仕様を保つ。動作設定は上のnative専用JSONへ分ける。通常のプレビューに単色背景を選んでも、モデル自体は透過なので同じ背景上で比較する。

## 確認結果

特定モデルの合否/指紋と公式再読込の最終結果は、同名の[画像なし検証記録](PART_FIRST_INOCHI_VALIDATION.json)を参照する。ファイル生成、公式動作、自然な外見を別判定にしている。

| 判定 | 結果 |
| --- | --- |
| ファイル生成 | 合格。45項目/ZIP CRC/33PNGからのモデル再生成/同設定の全バイト一致 |
| 公式Creatorでの実動作 | 合格。指定モデルで26状態、実保存、新プロセス26状態の全viewport差0 |
| 中立と元の完成PNG | 近い外見を維持。公式で同条件比較して完全な画素一致は未達 |
| 自然な完成品品質 | 未合格。低開度の線、口の切替、首の影、境界差などを継続改善 |

最終生成INP/INXは各1,022,647 bytes、SHA `553001d0735e93a1158b8145d276bfec590038bb34c13f2a42e2bbf655f46e44`。公式保存INXは3,806,693 bytes、SHA `56c78d58d9872ec768c788910fe792b9ff474a53560728e635611eba009b4dce`。ZIPは6,387,944 bytes、SHA `3c78beb7e2f99162454f3ffa93abb88e79353b88506784c70b5c6e1310d98e88`。対象はラベンダー髪/バイオレット瞳/透過背景のテンプレート版1。この合格を任意の新パレットやAI素材へ無条件で流用しない。

- 前段の33PNG+完成PNGの34枚と、manifest/静止rig/中間/recipeが全バイト一致。元の画像1枚→5役割/詳細/頭/髪の生成器、worker/API、既存作業形式1〜12は変更していない。
- 同じ設定から2回生成し、45項目とZIP全体が全バイト一致。保存済みの33PNGからNodeで生成したINPと、ブラウザの自動生成INPも一致。CRC検査成功。
- 実INPを既存の独立CPU描画へ渡して通常/左右瞬き/途中/開口/頭/複合24状態を確認。折り返した三角形0、検査した首1,680画素のalpha不足0、固定胴体14,700画素の変化0。左右瞬きで反対の目の差0、口の動作で目の差0。閉眼側の虹彩寄与0。これは公式SDKの代替検証ではない。
- CPUの中立と元の完成PNGを同じ白背景で比較し、差のある11,150画素、最大色差3/255、平均0.00870853/255。完全な画素一致ではない。公式描画同士の比較は別に記録する。
- 公式Creatorで元の完成PNGと33パーツモデルを同じカメラ/100%倍率で比較。659,344画素のうち、差のある40,751画素、RGB差3を超える658画素（約0.10%）、最大色差30/255、平均0.0345874/255。髪/目/衣服などの境界と線に差があり、フィルタと重ね合成の全要因の分離は未完了。CPUの最大3を公式の結果として報告しない。
- 公式の各26状態で固定胴体3,780画素の差0。左右閉眼/半開で反対の目の差0、瞬きで口の差0、開口5段階で両目の差0。保存前後の33枚の格納RGBAが一致し、41ノードの親子、mesh/UV/三角形/マスク、6パラメータ25bindingsを保持。float丸め差の最大は3.5739133e-6。
- 最終Node99件とブラウザ150件（計249件）、build成功。初回の全体実行はソース修正によるViteの自動再読み込みが2件へ影響（148成功/2失敗）。修正中の結果を最終合格にせず、対象18件と、ソース固定後の全150件を再実行して成功。検査の閾値/タイムアウトは弱めていない。

```sh
node --test scripts/model-build/test.mjs scripts/model-build/*.test.mjs scripts/inochi2d/*test.mjs scripts/character-generation/*test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test
npm run build
```

Node24.19.0、Chromium151.0.7922.173（Debian13）で確認。新規の15単体/3ブラウザ試験は、6制御の独立性、閉眼raw0、メッシュの折り返し、PNG不変/格納RGBA、欠損/サイズ/空PNG/図形/不正親の拒否、保存済み33PNGからの再生成、モデル生成途中の中止/旧結果保持、INP/INX単体保存、ブラウザとNodeの同一出力を確認する。既存のスマホ寸法試験では新しい保存ボタンも48px以上、320/390/844/1280幅で横はみ出しなし。

### 公式Creatorの検証方法

未改変の公式Linux版0.8.6（バイナリSHA `2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc`）、Xvfb 1280×960、Mesaソフトウェア描画で行う。SDK固定revは`dda3a8f005f808104caa43183ab8753fb989e30f`、Creatorタグのrevは`371e5f4e21117102dbecc82371bfd9a6e2f5df02`。Windows/iPhone実機の確認ではない。

生成したINXから私用の作業コピーを開き、値をOCRで確認して26状態を撮影する。表示は小数2桁（指定.075は表示.08）なので指定値と実表示を両方保存する。通常状態へ戻してから実際にCtrl+Sの完了とファイル更新を観測。保存前後の格納RGBA、親子/mesh/マスク/6パラメータ25bindingsを既存の厳密な検査で比較する。新しいCreatorプロセスで保存INXを開き、同じ26状態のviewportを比較する。

元の完成PNGも別の参照専用モデルへ格納して公式Creatorで表示し、同じカメラ/表示倍率で中立を比較する。参照画像一枚で動作するモデルに置き換えていない。検査用モデルは製品ZIPに含めない。

初回の階層比較は、Creatorが`root`を`Root`へ正規化したことで失敗した。変換側のnative表示名を公式に合わせて修正し、入力ID/配置はそのまま、検査条件を弱めずに修正版を再検証した。初回のファイルを最終合格モデルとして扱わない。

## 使い方と再生成

ブラウザでは「パーツから生成」→「テンプレートの女の子」→生成。モデル生成も自動で行う。完了後、INP/INXの個別保存、または「パーツと設定をZIP保存」で取得する。生成途中の中止/失敗は前回のPNGとモデルを保持する。ZIPの旧作業ファイルとしての再読込は未実装。

Web画面は通常顔の静止プレビュー。ブラウザ内で動くInochi2Dランタイムは未接続で、動作は保存したモデルを公式Creatorで確認する。Inox2Dのraw0/透明度の課題は別のまま。

```sh
npm ci
npx playwright install chromium
npm run dev
```

別ターミナルで実行する。入力画像/AI用Python/モデル重みは不要。出力先の親は既存、末尾のフォルダは未作成にする。Git内保存と上書きは拒否する。

```sh
# 33パーツ＋完成PNG＋動作モデル＋設定ZIP
node scripts/character-generation/export.mjs --output /tmp/NEW-generated-inochi
# 同じ設定で再実行
node scripts/character-generation/export.mjs --recipe /tmp/NEW-generated-inochi/generation_recipe.json --output /tmp/NEW-replay
# 保存済みの33PNG+manifestからモデルだけを再生成（開発サーバー不要）
node scripts/character-generation/model.mjs --input /tmp/NEW-generated-inochi --output /tmp/NEW-model-only
# 元の静止素材だけを出力
node scripts/character-generation/export.mjs --static-only --output /tmp/NEW-static-only
```

WindowsのPowerShellでは`--output "$env:USERPROFILE\Documents\NEW-generated-inochi"`などへ置き換える。Playwright付属Chromiumを使える。現在のクラウドで`/usr/bin/chromium`を使う場合だけ、コマンドの前に`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`を付ける。iPhone/Safari/Windowsの実機動作や別ブラウザ間のPNG全バイト一致は未検証。

独立した比較画像は既存のPython環境を使う（`.venv`の準備は[前段の再現手順](REPRODUCING_CHARACTER_RIG.md)）。私用の新しいフォルダへ出す。

```sh
.venv/bin/python scripts/character-generation/render-inochi.py --input /tmp/NEW-generated-inochi --output /tmp/NEW-motion-comparison
```

公式GUIの再現では[Creator環境の準備](INOCHI2D_CREATOR_CHECK.md)に従い、公式0.8.6を起動して通常の案内を閉じ、Parametersパネルを表示する。現在の確認用レイアウト（幅100px拡張、viewport x=358..1170）専用であり、別の画面配置では手動で同じ値を確認する。アプリやモデルを改変して試験を通さない。

```sh
# 別の私用コピー creator-saved.inx を公式Creatorで開いてから
.venv/bin/python scripts/character-generation/verify-creator.py --input /tmp/NEW-generated-inochi --model /tmp/creator-saved.inx --output /tmp/NEW-official-before --xdotool /path/to/xdotool
.venv/bin/python scripts/inochi2d/save-creator.py --working /tmp/creator-saved.inx --generated /tmp/NEW-generated-inochi/character.inx --output /tmp/NEW-save-report.json --xdotool /path/to/xdotool --input-delay-scale 2.5
.venv/bin/python scripts/inochi2d/check-creator-save.py --generated /tmp/NEW-generated-inochi/character.inp --saved /tmp/creator-saved.inx --output /tmp/NEW-textures.json
.venv/bin/python scripts/inochi2d/check-rig-retention.py --generated /tmp/NEW-generated-inochi/character.inp --saved /tmp/creator-saved.inx --output /tmp/NEW-rig-retention.json
# Creatorを終了し、新プロセスで保存INXを開き直してから
.venv/bin/python scripts/character-generation/verify-creator.py --input /tmp/NEW-generated-inochi --model /tmp/creator-saved.inx --output /tmp/NEW-official-after --xdotool /path/to/xdotool --compare /tmp/NEW-official-before
```

参照PNGの公式比較は、`node scripts/character-generation/reference.mjs --input /tmp/NEW-generated-inochi --output /tmp/NEW-reference.inx`を生成し、別の公式プロセスで開いて`verify-creator.py --neutral-only`で撮影する。`analyze-creator.py --evidence BEFORE_DIR --reference REFERENCE_DIR --output NEW_PRIVATE_REPORT.json`で元PNGとモデルの同条件比較と6状態の縮小一覧を作る。

## 残る品質課題

自然な完成品品質は未合格。低開度のまつ毛の厚みと上まぶたの境界、口の開き始めの線の切り替え、首の影の追従を改善する余地がある。通常顔はテンプレートの様式で、視線/発音/表情の広い変化、顔の立体角度、独立した髪物理、任意AIパーツの整合性、スマホ実機は後続。公開/画像送信/課金/Cubism互換を今回の成功へ含めない。

モデル/画像/ZIP/公式画面写真はGit外に保持する。クラウド環境の存続は保証されないため、ソース/固定依存/設定/手順からPCで再生成する。古い約26MB ZIPはSHA `18bf753fd4d94afa443f28bed6648641436b546ed05638a27331d721bf92a1cf`のまま変更していない。

## 変更ファイルと私用成果物

- `shared/generated-character-inochi.js`：元中間データの階層/位置を引き継ぐ独立変換、実PNG検査、曲線/mesh/キー、premultiply/legacy格納。
- `src/character-generation/model-generator.js`、`panel.js`、`archive.js`：元の33PNG生成を包んで自動リギング、進捗/中止/旧結果保持、モデル保存と45項目ZIP。
- `scripts/character-generation/export.mjs`、`model.mjs`：同じブラウザの生成を再利用し、モデル付き/静止のみ/既存33PNGからの再生成。
- `render-inochi.py`、`verify-creator.py`、`reference.mjs`、`analyze-creator.py`：既存の独立描画と公式操作/保存検査を再利用した品質/動作/中立比較。旧`model.mjs`/`quality-model.mjs`/`head-rig.mjs`自体は不変。
- `inochi-test.mjs`、`tests/character-inochi.spec.js`、既存新モード試験、開発ルール/README/計画/進捗/今回設計と検証記録。

今回の保存先は以下。これはクラウド内部の場所で、iPhoneから開けるダウンロードURLではない。転送作業は再開していない。

- `/tmp/part-first-inochi-final-v3`：45項目、生成INP/INX/ZIP/元の完成PNGと33パーツ。
- `/tmp/part-first-inochi-quality-v2`：独立診断24状態、動作一覧画像、品質レポート。
- `/tmp/part-first-inochi-official-v2`、`/tmp/part-first-inochi-official-reloaded-v2`：公式26状態ずつと全比較画像。
- `/tmp/part-first-inochi-roundtrip-v2`：公式保存INX、RGBA/rig保持、左右/口の独立確認、6状態の一覧画像、元プレビューとの公式比較画像。
- `/tmp/part-first-inochi-replay-v2`、`/tmp/part-first-inochi-rebuild-v2`：再生成一致の確認用。v1フォルダは初回の試験で最終モデルと区別する。

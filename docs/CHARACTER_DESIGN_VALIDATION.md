# 共通デザイン・33パーツ・Inochi2Dの検証

2026-10-24、基準`ccbb93a`、`feature/part-first-character-generation`を継続。設計整理を先に[設計文書](CHARACTER_DESIGN_GENERATION.md)へ保存し、既存の処理を再利用して追加した。

**実AIキャラクター生成は未接続・未検証。** 今回は共通デザイン/パレット/配置/出典とprovider契約、端末内描画による複数形状、モデル化/品質検査を進めた。新しい有料契約、課金、外部への文章/画像送信、公開/main統合は行っていない。[候補サービス・費用と取得できなかった資料](AI_PARTS_PROVIDER_COMPARISON.md)。

## 合否を分ける

| 項目 | 判定 |
| --- | --- |
| 端末内描画の3デザイン | 3/3で独立33PNG→49項目ZIP→INP/INXを自動生成。AI画像の成功率ではない |
| 同設定の再生成 | 3/3で49ファイルとZIP全体が全バイト一致、CRC成功。保存済み33PNGからもモデル化可能 |
| 公式Creator互換 | 各3体の26状態→実保存→新プロセス26状態、全viewport差0。33格納RGBA/親子/mesh/マスク/6制御25bindingsを保持 |
| 独立した描画/構造 | 3×24=72状態。検査した首のalpha不足、固定胴体変化、折り返し、反対の目/口への干渉0。CPUは公式SDKの代替ではない |
| 実AIの複数キャラ/一貫性 | 未実施。外部未承認/GPUなし/モデル未接続のため成功率は未計測 |
| 自然な完成品品質 | 未合格。既存の閉眼の線、口の切り替え、首の影なども残る |

AIの代わりに図形を出してAI成功とする処理はない。`ai_generated:false`/`ai_generation_performed:false`をUI/manifest/依頼仕様/レポートに記録。実行されていない公式/自然さ検証のflagを生成器が自動でtrueにしない。

## 3つの端末内デザイン

設定は`scripts/character-generation/design-examples.json`。髪や瞳の色だけでなく、髪の長さ、目の形/矩形、顔/支点、首の追従範囲、袖の形が変わる。陰影/線幅は全33パーツで同じ設計を参照する。

| 例 | 設定の主な違い | 生成モデルSHA256 |
| --- | --- | --- |
| soft | ラベンダー/ロング/丸い目/やわらかい輪郭/クラシック | `936a1fb11bd7afc3c70bbefa1f2299d36370d6c7d3e075ccd57304d787e8db63` |
| bob | 茶髪ボブ/青い瞳/アーモンド形/カフェメイド/明るい | `624bdc2af969abbf93473df2829f09e520efab65876a09285153e8e17ec4a282` |
| cool | 銀髪/琥珀/つり目/すっきりした輪郭/クール | `a63b2413739c36564424657e30a77d090646d3df01b7c9ecd31d36f9ff48c308` |

独立CPUの元プレビュー比較は同じ白背景で、最大RGB差soft3/bob2/cool3、平均0.00911/0.00818/0.00872程度（各255中）。完全一致とは報告しない。この数値は公式の元絵比較やAIの意味的な一貫性の点数ではない。別の消費側でダウンロードした33PNGを位置/順序/clipから合成し、完成PNGとの画素差0も確認した。

各45〜49秒程度はブラウザ生成/保存＋CPU24状態の診断を合わせた開発環境の測定。画像だけのAI生成速度ではなく、性能保証でもない。実測は[画像なし記録](CHARACTER_DESIGN_VALIDATION.json)に分離する。

## 公式Creatorの実物確認

公式Linux Creator0.8.6、未改変binary SHA`2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc`、Xvfb1280×960/Mesa。Windows/iPhoneの検証ではない。顔・目・口の検査範囲は新版のmanifestから選び、表示された6制御の値をOCRで照合する。指定.075はUIで.08表示なので両方を記録する。

26状態は通常、左右別閉眼/半開、両目の複数開度、口5状態、頭X/Y/Z両端と複合、通常へ戻る操作。編集キーを追加せず、すでに自動生成されたモデルを操作する。保存を実ファイルの更新と安定したhashで観測し、別プロセスの保存済みINXで全状態の表示を比較した。固定胴体ROIは各3,780画素で変化0。保存した33テクスチャRGBAが一致し、階層/mesh/UV/三角形/マスク/6パラメータ25bindingsも保持。float丸め差最大6.667e-6。

保存したINXのSHAはsoft`599c57822fd4502d2e399365999ff6cb4156b714afe02d9d0ef65e92bb27a85a`、bob`d988a74fd4d8992437e441d6c324f4630dfd6f37294379cd04064b1ff6fa7aaa`、cool`2de8232020f20354cdbe68ed1ef5cb4c4a81791e60930fb8b13ff97a85dfafe3`。自然さを合格にするものではなく、他のAI素材やパレットへの一律保証でもない。

## 既存機能とテスト

旧版1のテンプレートからのINP SHA`553001d0735e93a1158b8145d276bfec590038bb34c13f2a42e2bbf655f46e44`、45項目ZIP SHA`3c78beb7e2f99162454f3ffa93abb88e79353b88506784c70b5c6e1310d98e88`は更新後も全バイト一致。旧33PNG/静止JSON/モデルと元の画像1枚→5役割/詳細/頭/髪の生成器を保持。旧作業版1〜12も維持する。

- 最終Node121件/ブラウザ156件=277件、build成功。新規22単体/6ブラウザで、デザイン/出典/role/配置の混在や未知項目の拒否、再生成、JSONキー順の許容、source PNG/preview/ZIP/model、処理中止/再試行/以前の結果の保持、スマホ寸法などを検査。
- opaqueな背景タイル、空/サイズ違いPNG、未知/未接続AIや偽のAI出典は拒否。旧版の有効入力は変更しない。
- つり目の左右の向きは外側の端が高いことを回帰検査。目/まつ毛の一貫した条件で生成しても、意味と実際の向きが逆になった初回の問題を修正した。
- 最初のJSON Schema構文不備は独立検証で検出・修正し、旧manifestと新3manifestをそれぞれのschemaで確認。新版は版1の33パーツ定義も参照する。`option`のdisabled判定はnativeの`disabled`プロパティで確認し、provider自体の呼出し拒否も実際に検査した。
- 320/390/844幅で横はみ出しなし、主要な入力/選択/保存48px以上・16px以上。iPhone/Safari実機の成功とは報告しない。

```sh
node --test scripts/model-build/test.mjs scripts/model-build/*.test.mjs scripts/inochi2d/*test.mjs scripts/character-generation/*test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test
npm run build
```

Node24.19.0/Chromium151.0.7922.173/Python3.12.14。optional診断依存はrequirements-diagnostics.txtへ固定した。実AIのSDKはアプリへインストールしておらず、公開ソースを調査しただけ。新しいアプリ依存パッケージやAPIキーは追加していない。

## 保存と次の作業

生成/再生成/公式自動確認のコマンドは[設計・再生成](CHARACTER_DESIGN_GENERATION.md)。private画像/モデル/ZIP/画面写真はGit外に保持する。設定・スクリプト・依存・手順をGitへ保存し、環境消失時に画像アップロードなしで3例を再作成できる。

- `/tmp/character-design-verified`：選択した3デザインのPNG/manifest/INP/INX/49項目ZIP、CPU72状態、比較画像、設定。
- `/tmp/character-design-replay`：同設定の再生成。各49ファイル/ZIP一致。`generation_report.json`にはコード/ブラウザ/入力設定を記録。
- `/tmp/character-design-final/official-soft`：選択したsoftと同一SHAの公式26+26状態、保存INX、RGBA/構造/独立確認。
- `/tmp/character-design-official/bob`、`cool`：自動起動した公式26+26状態ずつと保存/再読込/独立確認。

これらはクラウド内部の保存先で、iPhone用のダウンロードURLではない。以前の26MB ZIPも変更していない。Windowsでの取得/再生成はPC利用時に行えるが、クラウドの永久保持は保証しない。

次は最新の価格と利用条件を確認した上で、実provider/出典/費用管理を追加する段階。実AIの自由形状、任意衣装で不要な役割の扱い、参照からの接続/髪根元の推定、hidden region補完、実AI画像の一貫性は未完成。現在の閉眼/開口の線や首の影の品質、ブラウザの実Inochi再生、実機、Cubism/VTube Studioも別課題。価格が確認できないまま課金承認を求めず、料金/上限/送信内容を具体化してからオーナー判断へ進める。

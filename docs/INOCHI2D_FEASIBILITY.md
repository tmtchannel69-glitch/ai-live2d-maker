# Inochi2D導入調査と最小モデルの実動作検証

2026-10-21、`research/inochi2d-feasibility`。既存アプリを書き換えず、独立した試験用コードを追加した。今回の承認範囲は公開ソース調査・実装計画・最小構成の生成/読込/動作確認。画像1枚から自然なモデルを完全自動生成する最終目標の達成とは分ける。

## 結論

**画像パーツ・メッシュ・パラメータからInochi2Dモデルを自動生成し、公式Creatorで動かす経路は実現可能。** 自作の顔・左右の目・閉じたまぶたの5パーツからINP/INXを生成し、未改変の公式Creator 0.8.6で読み込んで左右独立の瞬きと顔の平面移動/傾きを確認した。

採用候補は、既存の素材準備を共有する**追加の出力先**。Live2D/MOC3を置き換える形式ではなく、VTube Studio互換も確認していない。画像の意味分離・隠れ部分の補完・自然な表情の推定は別の問題で、Inochi2Dのメッシュ/補間機能だけでは解決しない。

ブラウザ候補Inox2Dは実WASM/WebGL2で読込/一部変形を確認したが、今回の瞬きは不合格。透明度bindingが未実装で、値0のパラメータを適用しない問題も再現した。公式SDKの開発版にはWASM経路があるが、安定版や完成済みブラウザrendererと混同しない。

## 固定したバージョン

| 対象 | 固定版 | 用途 |
|---|---|---|
| SDK安定版 | v0.8.6、`dda3a8f005f808104caa43183ab8753fb989e30f` | 旧INP1の生成仕様、基準実装 |
| Creator | v0.8.6、`371e5f4e21117102dbecc82371bfd9a6e2f5df02` | 公式Linux公開バイナリで実読込/描画/GUI操作。バイナリ内の依存パスもSDK0.8.6 |
| SDK近接版 | v0.8.7、`e2235f6f29688d4013a0eec116a37ec8af8f1fb5` | 参考照合。コンテナと主要deserialize処理は0.8.6と一致、描画まで同一とは主張しない |
| Inox2D | `d4dd9dd7f16b775042cbda44370570abf9a8cf81` | 元ソースを変えずRust/WASM/WebGL2比較 |
| SDK開発版 | `4975d247f9b946a74d18e0ba9b3e9475eb636efb`、v0.9.0 | INP2/WASMのソース調査のみ |
| Creator開発版 | `28a6f41d4286a46219ff35c35304b29e5da46a95` | 安定版と別に識別。今回の実機能合格には使用しない |

日付やmainの名称だけで再現性を判断せず、上記commitと入力モデルのSHAを検証記録へ保存する。

## 1. 自動リギングに使える機能

| 公開実装 | 再利用できる内容 | それだけではできないこと |
|---|---|---|
| SDK `core/meshdata.d` | `createQuadMesh`/`regenerateGrid`、頂点/UV/三角形 | 画像中の目や髪の意味を認識すること |
| Creator `viewport/common/automesh/{grid,contours}.d` | alpha境界・連結成分・輪郭からメッシュ候補を作成 | 元画像1枚を意味ごとのパーツへ分離すること。UIのAuto Segmentationはalpha輪郭処理 |
| Creator `viewport/common/mesh.d` | 三角形分割、重心座標による別メッシュへの変形転写 | 正しい閉眼/口内/顔向きを推定すること |
| SDK `core/param/{package,binding}.d` | 1軸/2軸キー、補間、deform/値binding、反転/コピー | 自然なキー形状を自動設計すること |
| SDK Node/Part/MeshGroup | 親子変換、マスク、透明度、描画順、変形の子への適用 | 隠れた肌や後ろ髪の描き足し |
| SDK animation/automation/physics | 外部入力、アニメーション、周期運動、物理の土台 | 良質な動き/物理係数の自動推定や追跡精度の保証 |
| Creator PSD/KRA import/INP export | レイヤー入力、パラメータ整理、MeshGroup展開、atlas/UV整理 | 他社モデル形式へのコンパイル |

今回のJS試作は公開仕様をもとに独立して実装した3×3格子と固定の動きテンプレート。Creator全体の移植や既存画面の置換ではない。輪郭メッシュ、マスク、MeshGroup、物理は最小試験の対象外。

## 2. INP/INXとINP2を区別する

安定版の旧INP1コンテナは次の順序。

```text
TRNSRTS\0                 8 byte magic
u32 big-endian            UTF-8 JSONのbyte数
JSON                      meta / nodes / param / physics / automation / animations
TEX_SECT                  8 byte section
u32 big-endian            テクスチャ数
各画像: u32 BE長 + u8 codec + encoded bytes
任意: EXT_SECT            vendor名とpayloadの追加セクション
```

PNG=0、TGA=1、BC7=2という識別値がある。今回の生成/独自検査は8bit RGBA PNGのみ。全codec対応としない。文字数ではなくUTF-8のbyte数を記録する。

`.inp`と`.inx`は同じmagic/readerを使う。通常INXは編集用、INPは配信用で、Creatorの通常exportはグループ整理・MeshGroup展開・atlas化等も行う。今回のNode/Partだけの最小グラフは同じpayloadで両拡張子を生成できるが、任意の編集プロジェクトが単純な拡張子変更で変換できるという意味ではない。Creator保存後のINXには編集用の情報が増える。

**開発版INP2は別形式**。上記SDK開発snapshotの`tech-docs/inp2.md`では`TRNSRTS2`、little-endian、32bit境界、型付きデータノード、blob CRC32を使用する。旧JSON長prefixを書いてINP2と呼んではいけない。開発版loaderはmagicによる旧/新分岐を持つが、すべての旧モデルが同じ表示になることまで確認したものではない。今回の生成器はINP2を出力せず、検査でも明示拒否する。

## 3・4. 自動生成と公式Creatorでの検証

`scripts/inochi2d/`に試作を分離した。

- `create-fixture.mjs`：目口のない顔肌、左右の開眼、左右の閉眼を自作図形で作成。AI分離や提供キャラクターの品質試験ではない。
- `model.mjs`：PNGから45頂点/40三角形/5テクスチャのグラフを自動構成。左右EyeOpenと親HeadXを生成。
- `generate.mjs`：manifestの5役割を読み、INP/INX/JSON/生成reportを新規出力。既存アプリの保存形式を変更しない。
- `test.mjs`：コンテナ、画像保持、非退化メッシュ、左右の参照、親への追従、不正入力、CLIの上書/リンク拒否等を検査。

各Partは配置中心をnode transformへ、頂点はその中心の周囲のpx座標へ変換する。bindingのdeformは頂点の絶対位置ではなく移動量。EyeOpenは0=閉/1=開、HeadXは−1〜1で平面移動と小さいZ回転。立体的な顔向きではない。RootはCreatorが読込時に基本変換を初期化するため、HeadをRootの子に置いた。

```sh
node scripts/inochi2d/create-fixture.mjs --output /tmp/new-inochi-trial
node scripts/inochi2d/generate.mjs \
  /tmp/new-inochi-trial/manifest.json /tmp/new-inochi-trial/minimal
node --test scripts/inochi2d/test.mjs
```

画像/モデルはGit外。元PNGはバイトを保持し、manifest256KiB・各PNG8MiB/2048px・全展開RGBA16MiB・出力32MiBを制限。INP/INX検査は今回の最小PNG構成だけで、汎用の安全な任意モデルvalidatorではない。生成reportの`officialCreatorTested:false`は生成だけでは合格にしないための値で、実試験結果は別のSHA付き検証reportに保存する。

実試験環境はクラウドのLinux x86_64、公式Creator0.8.6未改変、Xvfb、Mesa llvmpipe OpenGL4.5。Windows/スマホ実機とは区別する。基準モデルと、Inox向けに省略可能metaを空文字/falseで明示した同形モデルを分けて保存した。後者のSHA256は`18fbffbfa3816f268585fd68e9cffac5954e109a6cb5e423149d847dc43bc5dc`。

| 公式Creatorの実操作 | 確認結果 |
|---|---|
| INPの読込と表示 | 顔・左右の目・閉眼、Headと3パラメータが表示 |
| 左/右の0と1 | 閉眼側の青い瞳画素0、反対側の目ROI差0 |
| 途中の開き | GUI表示0.48で左右の変形を確認。狭いバーのクリックが量子化されるため正確な0.5とは記録しない |
| 両目閉/顔移動との組合せ | 閉眼と顔の平面移動/傾きを実描画で確認 |
| HeadX −1/+1 | viewport内39,356/39,971画素が通常時から変化 |
| 元の状態へ復帰 | 同じviewportの画素差0 |
| 生成INXをCreatorで保存して別プロセスで再読込 | 5パーツ/3パラメータ/8bindingsを保持し、全12状態で保存前とのviewport画素差0 |

通常のパラメータUIを自動操作して12状態を実行した。追跡入力・内蔵アニメーションclipの自動再生・自然なキャラクター品質の検証とは分ける。最初の「顔/目/まぶたを持つモデルで瞬きと簡単な顔の動きを出す」技術条件は公式Creator経路で確認できた。

私用成果物は`/tmp/inochi2d-trial/`。元モデルは`minimal.*`、最終のmeta明示版は`minimal-complete-meta.*`、実UI記録は`creator-verification-complete-meta/creator-ui-report.json`とPNG、保存再読込の要約は`creator-validation.json`。Creator保存済みINXは20,346bytes、SHA256`b4cf024d98abff57579f41440c76bd69f4a762bc3edac9735d9fe8e8004fcf10`。画像やCreatorバイナリをGitに含めず、コード/画像なしの記録だけ保存する。[公式Creatorの再現メモ](INOCHI2D_CREATOR_CHECK.md)も参照。クラウド終了後の/tmpや起動プロセスの保持は保証しない。

ダウンロード用`inochi2d-minimal-trial.zip`（175,826bytes）には生成INP/INX、Creator保存INX、入力5PNG/manifest、実試験reportと公式描画比較をまとめた。Creator本体やWASMは含まない。[画像なしの合否snapshot](INOCHI2D_VALIDATION.json)をGitへ保存し、元画像1枚の全自動化やInox瞬きが合格したと誤読しないよう各項目を区別した。

## 5. ブラウザプレビューの比較

| 方式 | 実装/確認状況 | 判断 |
|---|---|---|
| SDK安定版0.8.6 | D/OpenGL。公式Creatorで今回の描画/パラメータが動作 | 生成結果の基準。これをそのままブラウザへ置く完成経路は今回未検証 |
| SDK開発版0.9 snapshot | WASM/C FFI/TS wrapper、旧/新形式loaderのソースあり | 有望だが別検証が必要。patched druntime等が必要でbring-your-own-renderer。PixiJSの該当ファイルはこのpinで空。完成済みブラウザviewerではない |
| Inox2D固定HEAD | Rust/glow、WASM+WebGL2。今回は実build/読込/一部変形/平面移動を確認 | 最小瞬きに未達。未修正のまま本番previewへ採用しない |

Inox試験は元ソースを変更せず、raw値0/.5/1を渡した。最初のSDK最小meta省略版は`meta.artist key does not exist`で拒否される。公式SDKで省略できる項目もInoxはキー存在を要求するため、画像とrigを変えず空文字/falseで明示したモデルを作り、同じbytesを両方へ渡した。

そのモデルのInox結果は、.5で1,979画素とdeform最大6.5475が変化する一方、閉値0では差0で目が閉じない。`params.rs`は値がZEROのときparameterをskipし、opacity bindingもTODOで適用しない。開眼にも閉眼線が重なる。HeadX±1は15,138/15,137画素が変化した。近0の.0001が変化する比較も残したが、0の不具合を隠す回避や合格判定には使わない。

実WASMは603,392bytes、binding JS32,026bytes。このサイズは今回の小wrapperの値で、製品全体の容量・スマホ速度の保証ではない。ブラウザで読めることと正しく動くことを分け、MeshGroup/animation/透明度/0値/マスク/描画順/物理を対象モデルごとに検証してから採否を決める。

再現用の独立Rust/HTML/JS、Git rev固定Cargo.toml/Cargo.lock、検査スクリプトと通知文は[`scripts/inochi2d/browser-trial/`](../scripts/inochi2d/browser-trial/README.md)。生成WASM/JSbindings/モデル/画像はGit外。ローカルの信頼できる検証素材だけを対象にし、任意のアップロードを受ける製品用loaderにはしない。rootがこの保存済みスクリプトでも再検証し、同じ画素/変形量と不合格を再現した。

## 6. 既存処理を共有する構成案

```text
画像 → 意味分離/欠損補完 → 共通の制作データ → 出力adapter
                                 ├ Live2D用（既存の試験経路）
                                 └ Inochi2D INP1（今回の新試作）
```

共通データにはrole・元画像基準の配置・元PNG・メッシュ・親子・マスク・動きキー・素材の権利/由来を保持する。出力形式固有のUUID/JSON/texture slotをここへ混ぜず、adapterで変換する。

| 現在のアプリ資産 | 再利用/変換の方法 |
|---|---|
| SAM結果、補正PNG、生成済み不足素材 | role/配置を共有。背景除去・補完自体はInochiにも必要 |
| `authoring-handoff.js`の元サイズ/配置/role | adapter入力に使用可能。今回のCLIは5役割manifestだけで、handoff全項目の取り込みは未実装 |
| `expression-deform.js`の9点と閉/開キー | 配置の幅/高さを掛け、基準頂点との差をdeform offsetsへ変換。UV/上下と中間値を再検証 |
| `expression-groups.js`/`group-motion-keys.js` | Head/目/口の親子と3位置キーへ。角度は度→radian、描画順はInochiのzsort方向に変換 |
| 範囲/範囲追従/clip keys | 対応するmaskノードと動きへ変換する工程が必要。今回の最小試作では未対応 |
| `motion-state.js`と生成用テンプレート | 意味ごとの開閉/頭/髪の辞書を共有する案。既存設定は独自preview用で、学習済みの自然なモーション辞書が完成しているとはしない |

既存Live2D向けの素材分離/補完を捨てる必要はない。アプリの保存版1〜12と現在のモデル生成を維持し、新形式の出力先選択を追加する順序が適切。

## 7. Live2D形式との互換性

INP/INXはMOC3/model3.jsonではなく、形式の互換性はない。調査した公式SDK/Creator/Inoxに、CubismのMOC3を出力する経路は確認できなかった。VTube Studioで今回のINP/INXを読む試験も行っていないため、対応表示をしない。

レイヤー/メッシュ/意味パラメータという考え方は共通にできるが、マスク・変形・物理・補間・描画順が違う。将来の変換は共通制作データから各形式を**別々に生成して検証する**計画とし、任意のINP↔MOC3変換ができるという約束にしない。最終用途をInochi Session等へ切り替える決定も今回していない。

## 8. ライセンスと素材

SDK/Creator/Inox本体は各固定版LICENSEでBSD-2-Clauseを確認した。改変/商用利用を許すが、ソース再配布時はcopyright/条件/免責、binary再配布時も資料等へ同じ表示を保持する。ライブラリ本体のBSDが、依存・フォント・ブランド・サンプルモデルまで一括許諾するものではない。

主な確認済みD依存はimagefmt2.1.0/numem0.11.1/kra-d0.5.6がBSD-2、inmathがMIT、i2d-opengl/fghj/bindbc-sdl/i2d-imgui/dcv等がBoost、silly1.1.1がISC、tinyfiledialogsがZlib。psd-d0.6.1はmanifestのBSD宣言だけで本文未確認、i18n-d1.0.2も未同定。全推移依存/配布binaryの網羅監査は完了していない。フォントはNotoがOFL、Material IconsがApache-2等で別条件。OpenDyslexicは付属文と実font内の表記に相違があるため、Creator自体を再配布するなら実物の確認が必要。今回の案はCreatorのUI/フォント/brandingを製品へ同梱しない。[固定版と上流LICENSEの確認表](INOCHI2D_LICENSE_AUDIT.md)、[Inox固定依存のSPDX一覧](../scripts/inochi2d/browser-trial/DEPENDENCIES.md)を参照。宣言の一覧をbinary配布に必要な本文/NOTICEの代わりにしない。

公式example-modelsのAka/MidoriはREADMEにseagetch著作・CC BY4.0とある。SDKのBSD扱いで素材を無断転載してはいけない。今回の5枚は自作検証図形でCC0と明記し、ユーザー画像/生成画像にはこの条件を自動適用しない。モデルmetaの空の権利欄も利用権の付与ではない。

## 未取得の資料と今回の限界

指定の[Zenn記事](https://zenn.dev/riti0208/articles/db69f68eaab5d1)はHTTP403で本文を取得できず、記事の内容を読んだ根拠として使用していない。

公式[example-models](https://github.com/Inochi2D/example-models/tree/cd95dd00ddff63b1f7d2b84a19914c3c70d05945)はrepo取得できたが、モデルはGit LFS pointer。Aka.inxの期待値は17,731,911bytes/SHA256`dbf82ffb86d1c761bca883ad37ec1c47487a447f8104290b459ce60aaee81e0f`。正規LFS/media/公開配布先の取得が拒否されたため、実体の形状やリグを解析済みとはしない。今回は公式のserializer/loaderを仕様の基準にして、独自に生成したモデルを公式Creatorで検証した。

未完了は、提供キャラクターでのInochi品質評価、1画像から手動指定なしの意味分離/補完/自然なキー推定、ブラウザでの正しい全機能描画、スマホ実機、追跡/物理の品質、Live2D/VTS互換。今回の最小合格を製品の完全自動化達成に拡張しない。

## 次の実装計画

1. 既存handoff→共通制作データ→Inochi adapterを追加する設計を確定。まず現在の5役割に絞り、既存Live2D出力/保存形式を保持。
2. 実キャラクターの左右目/まぶた/顔/髪で素材とキーの品質を評価。所有領域、背景の欠け、閉じ際、顔向きの穴を共通指標で確認。
3. ブラウザ方式を選定。Inoxの0値/opacityを修正し原版との回帰を行う案と、公式開発SDKのWASM+rendererを別固定版で評価する案を比較する。
4. その後に自動ランドマーク/分離・欠損補完・動きテンプレート選択へ進み、ライセンスの明確な複数画像で無操作の成功率/失敗検知を測る。
5. スマホ実機の読込/メモリ/描画/保存、利用先ソフトで検証。公開/正式採用/費用/新たなAPI契約/main統合は別途判断。

## 主な固定ソース

- [SDK0.8.6 container reader/writer](https://github.com/Inochi2D/inochi2d/blob/dda3a8f005f808104caa43183ab8753fb989e30f/source/inochi2d/fmt/package.d#L75)、[big-endian/magic](https://github.com/Inochi2D/inochi2d/blob/dda3a8f005f808104caa43183ab8753fb989e30f/source/inochi2d/fmt/binfmt.d#L9)
- [SDK mesh](https://github.com/Inochi2D/inochi2d/blob/dda3a8f005f808104caa43183ab8753fb989e30f/source/inochi2d/core/meshdata.d#L250)、[parameter binding](https://github.com/Inochi2D/inochi2d/blob/dda3a8f005f808104caa43183ab8753fb989e30f/source/inochi2d/core/param/binding.d#L283)
- [Creator alpha contours](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/source/creator/viewport/common/automesh/contours.d#L99)、[INP export](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/source/creator/io/inpexport.d#L298)
- [INP2仕様](https://github.com/Inochi2D/inochi2d/blob/4975d247f9b946a74d18e0ba9b3e9475eb636efb/tech-docs/inp2.md)、[開発版TS wrapper](https://github.com/Inochi2D/inochi2d/tree/4975d247f9b946a74d18e0ba9b3e9475eb636efb/web/inochi2d-ts)
- [Inox zero skip/opacity TODO](https://github.com/Inochi2D/inox2d/blob/d4dd9dd7f16b775042cbda44370570abf9a8cf81/inox2d/src/params.rs#L231)、[strict meta parser](https://github.com/Inochi2D/inox2d/blob/d4dd9dd7f16b775042cbda44370570abf9a8cf81/inox2d/src/formats/payload.rs#L496)
- [SDK LICENSE](https://github.com/Inochi2D/inochi2d/blob/dda3a8f005f808104caa43183ab8753fb989e30f/LICENSE)、[Creator LICENSE](https://github.com/Inochi2D/inochi-creator/blob/371e5f4e21117102dbecc82371bfd9a6e2f5df02/LICENSE)、[Inox LICENSE](https://github.com/Inochi2D/inox2d/blob/d4dd9dd7f16b775042cbda44370570abf9a8cf81/LICENSE)

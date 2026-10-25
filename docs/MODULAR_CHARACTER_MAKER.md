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

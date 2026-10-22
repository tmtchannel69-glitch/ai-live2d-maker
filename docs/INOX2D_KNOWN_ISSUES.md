# Inox2Dの既知の不具合（生成器とは別課題）

更新日: 2026-10-22。

対象は未改変のInox2D固定版`d4dd9dd7f16b775042cbda44370570abf9a8cf81`。公式Creator0.8.6を基準に動作したモデルでも、次の問題がある。生成モデルの値や画像を変えてブラウザだけへ合わせる修正は行わない。

| 課題 | ソースと実測 | 状態 |
|---|---|---|
| raw値0のパラメータが適用されない | `inox2d/src/params.rs`の`Vec2::ZERO`でskip。最小モデルのEyeOpenを0にしても開眼時からの画素差0、0.5では変形あり | 未修正 |
| opacity bindingが反映されない | 同ファイルの`BindingValues::Opacity`がTODO。開眼時にも閉眼線が表示される | 未修正 |
| 省略可能metaの扱い | SDKで省略可能なartist等をInoxは必須として読む。最小生成器では空文字/falseを明示し、画像/rigは不変 | 読込は確認、汎用互換は未確認 |

ソース: [0値とopacityの処理](https://github.com/Inochi2D/inox2d/blob/d4dd9dd7f16b775042cbda44370570abf9a8cf81/inox2d/src/params.rs#L231)。詳細な過去の実測と固定環境は[調査結果](INOCHI2D_FEASIBILITY.md)、[画像なしの検証snapshot](INOCHI2D_VALIDATION.json)を参照。

今後修正する場合は、元ソースと修正版を別々に固定して同じモデルのraw0/途中/1、左右独立、opacity、描画順を比較する。epsilonへの置換で0を隠した結果を成功扱いしない。今回は修正・製品のブラウザプレビューへの採用を行わない。公式Creatorの成功とInoxの成功を分ける。

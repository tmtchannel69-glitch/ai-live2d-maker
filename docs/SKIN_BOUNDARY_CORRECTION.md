# 閉眼時の補完肌の境界調整

2026-10-25。既存の5パーツ方式、詳細分離、頭/首/固定胴体のリギングを維持し、**既に推定した肌の色の境界だけ**を調整する。ぼけや隠れた肌の正確な復元を解決した機能ではない。

## アプリで使う

「画像から変換」→「頭・首・胴体を分ける（実験）」では、従来の自動分離/補完の後に境界調整を試みる。点・枠・手動リギング・外部画像APIは不要。従来の5パーツ方式は変更しない。

生成後、「確認する動き」→「目元の開閉10状態」で「肌の境界調整の前後」を切り替える。同じ開度の補正前/補正後を比べられる。**実モデルから描画した離散比較画像**であり、ブラウザランタイムや公式Creatorの画面ではない。頭の比較には補正前の姿勢画像を追加せず、対象外の切替を隠す。

画面に本人左右の境界色差を表示する。数値は選んだ肌の境界画素同士のRGB平均絶対差（0〜255）で、小さいほど近い。画像全域の再現率や自然さの点数ではない。肌の細部量の検査は従来の`inspect_skin`を再利用し、ぼけ候補が残れば表示する。判定閾値を緩めて警告を消さない。

保存モデルZIPには、従来のモデル/共通パーツ/20比較画像に、補正前の目元10枚、`skin-boundary-report.json`、**元の推定肌だけの**`skin-boundary-before.png`を追加する。元のアップロード画像は収録しない。保存済みZIPは元画像/APIなしで端末内再読込できる。旧版の結果確認も維持する。

## 何を変え、何を保つか

- `server/skin_boundary.py`を独立した後処理として追加。共通データの観測RGBAから周囲の肌を参照し、`eye_skin_underpaint`の補完RGBだけを変更する。観測PNG、所有マスク、補完mask/alpha、位置、目の形、まつ毛、メッシュ、親子構造、動作値は変更しない。
- 既存の肌補完を基準に、周囲との色差を滑らかなオフセットとして解く。周辺の肌に支持されない髪/目/線の色は境界条件に使わない。既存補完の片側勾配を外挿し、正しい照明勾配まで単純な色段差とみなさない。
- 疎行列のscreened harmonic補正。screen=.04、各RGBの補正上限±12、1眼の対象131,072画素まで。既存の可視肌由来の微小変化を残し、乱数の粒や新しい肌理を足さない。CGのrtol=1e-7/atol=1e-6/maxiter=250、非収束は明示的に停止する。
- 有効境界12組未満、対象過大、余白不足、測定した色差が改善しない場合は**補正を適用せず、元の実補完を保持**する。レポートに`applied:false`と理由を記録し、画面にも調整なしと示す。ダミーへの置換や改善成功にはしない。
- 旧5パーツ/詳細の基本準備器、`generate.mjs`、`parts-adapter.mjs`、`head-rig.mjs`、`blink-rig.mjs`、legacy writerは変更しない。CLIには任意の`--skin-boundary-correction`を追加するだけで、省略すると従来の生成を再現できる。アプリの詳細workerがこのflagを使う。
- `skin-boundary-before.mjs`は既存head loaderのbuilder差替えを再利用し、元の推定肌PNGだけを戻して補正前モデルを作る。観測/幾何/動作の異なるモデルを比較しない。補正前のモデル実体は私用trialに保持し、アプリZIPにはそのSHAとCPU比較画像を入れる。

`refine_eye_skin`は入力のgraph/assetsを変更せず、変更後の値を返す。補正を採用する前に色差を測り直す。観測を再分類していないため、目元に混じった髪や不確かなまぶたの所有は別の問題として残る。

## 保存形式

`common/parts.json`は版1のまま。`diagnostics.skin_boundary_correction`に結果を追加し、生成レポート版2に`skinBoundaryCorrectionRequested`を記録する。`applied`と「要求した」ことを混同しない。

`skin-boundary-report.json`は`ai-live2d-maker-skin-boundary-correction`版1、profile=`screened-skin-boundary-v1`。元のサイズ、本人左右の対象/有効境界数、適用の有無/理由、補正前後の色差、変更画素数、CG/補正上限、前後の推定肌PNGのSHA、前後モデルのSHA、従来と同じ肌ぼけ候補を保存する。official/appearanceの生成時flagsはfalseのまま。

`review/review.json`は比較がある場合だけ版2になり、目元の各frameに`before_file`/`before_diagnostics`を追加する。対象モデルのSHA、実肌PNGのSHA、前後の開度/寸法/ファイル一式を検査してから画面へ反映。補正前のモデルSHAはサーバーが実ファイルで照合して記録する。ブラウザは比較PNGの表示であり、ZIPに含めない補正前モデルを実行したとは主張しない。旧review版1も読める。

圧縮/展開80MiB・256項目、作業領域256MiB/512ファイル、詳細API600秒の上限は維持する。不足/不正/中止/遅延完了では編集内容と前のモデルを保持する。

## 再生成する

既存の依存・固定重みと、同じ元画像が必要。準備は[詳細モード](DETAILED_INOCHI_APP_MODE.md)を参照し、自動ダウンロードは行わない。出力はGit外の新しいディレクトリへ置く。

```sh
# 従来版。新しいflagを省略すれば以前のheadモデルを再現できる
OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 .venv/bin/python scripts/parts/rig.py --source /path/to/character.jpg --output /tmp/NEW-legacy-trial --stage head
# 境界補正。従来の分離/リギングと、補正前の同形モデルも生成する
OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 .venv/bin/python scripts/parts/rig.py --source /path/to/character.jpg --output /tmp/NEW-skin-trial --stage head --skin-boundary-correction
# 実コンテナの構造/alphaと、10開度の前後画像を比較する
.venv/bin/python scripts/inochi2d/compare-skin-boundary.py --trial /tmp/NEW-skin-trial --output /tmp/NEW-skin-comparison
# ローカル画面とAPIを起動してから、生成/中止/再試行/30表示/保存/端末内再読込を確認
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/inochi2d/verify-app.mjs --source /path/to/character.jpg --output /tmp/NEW-skin-app-check --url http://127.0.0.1:5180
```

`provenance.json`に元画像/依存/重み/コードの指紋と`skin_boundary_profile`を記録する。モデル/画像/ZIPをGitHubに保存せず、コード・設定・コマンドを保存する。クラウドの一時ファイルは永続保管ではなく、元画像を所有者が保持して再生成できるようにする。

## 判定の範囲

提供画像1枚では有効な境界の色差が約20%減ったが、肌のぼけ候補は残る。閉眼の線/髪/襟の境界、髪の前後関係、真の隠れ形状、別画像への一般化は未解決。今回検討した肌全体の再補間・まぶたノード追加・髪への所有変更は、目視上の改善や所属の正しさの根拠が足りず採用しなかった。

ファイル生成・公式Creatorの動作/保存・自然な見た目を別判定にする。出力はInochi2D legacy0.8.6用で、Cubism/MOC3/VTube Studio互換ではない。Inox2Dのブラウザ不具合、公開/有料サービスは別課題。[今回の検証結果](SKIN_BOUNDARY_CORRECTION_VALIDATION.md)。

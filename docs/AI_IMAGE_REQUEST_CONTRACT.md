# 2回画像生成試験：オフラインのリクエスト契約

2026-10-24。継続開発を受けて、実課金や外部送信を行わずに、参考画像と虹彩パーツのリクエスト・応答形式を安全に組み立てる部品を追加しました。

## 追加内容

- `server/ai-image-pilot/request-contract.mjs`：2回試験のreference（文章→画像）とiris_l（共通参照＋座標ガイドによる画像編集）の入力データを構築。勝手なモデル変更、3回目の実行、通常外のフィールド、承認済みとする改変を拒否します。
- 参考画像をユーザーが目視確認して確定した後、そのPNGのSHA-256と添付する実バイトを照合。2回目の元画像やガイドが変更された場合は入力データを生成しません。
- 画像編集の参照1枚とガイド1枚を順序どおりmultipartのFormDataに入れます。Content-Type境界値はHTTPクライアントに任せる設計です。
- APIの応答と同じ形のオブジェクトが与えられた場合、画像枚数・base64・PNG署名・ヘッダー寸法を検査し、画像の指紋とusage値を抽出します。ただしこの検査は真正性の証明ではありません。
- `scripts/ai-image-pilot/request-contract.test.mjs`：外部送信なしの4単体テストを追加。

## 実装境界

**OpenAI API呼出し、APIキー参照、課金、認証、送信実行器、画像生成、一般公開は一切行いません。** 返すオブジェクトの `authorized_to_send`、`network_request_sent`、`ai_provenance_verified`、`cost_verified` は false です。

現状はリクエストの**形式検査**です。plan_idのSHA形式は検査しますが、この部品単独で計画の署名・真正性を保証しません。将来実行器を作る場合、既存の`validatePilotPlan`による正規の計画全体との照合、別途明示された所有者承認、実費が不明な時に止まる永続的な予約台帳、秘密鍵の安全管理が別途必要です。

PNGについては、署名・IHDRの寸法/色タイプのみを素早く検査します。完全なPNG/CRCや実際の画素・透明・ガイドの意味的品質の検証には、既存のfast-pngに基づく`check-parts.mjs`、人手によるレビューが必要です。テスト画像はヘッダーのみのfixtureで、本物のAI生成画像や有効な完成PNGではありません。

## 手順

```sh
node --test scripts/ai-image-pilot/request-contract.test.mjs
```

既存の`feature/pilot-evidence-assessment`にある`assessment.mjs`、予算管理`cost-control.mjs`、33パーツ自動生成、Inochi2D出力は変更していません。画像・キー・非公開コストデータはGitHubへアップロードしません。

次はCodexが既存のブラウザ/Nodeテスト一式を実行し、パイロット計画の全体検証と応答PNGの完全デコード検査を接続してから、別途課金承認とAPIキー保管について判断する段階です。

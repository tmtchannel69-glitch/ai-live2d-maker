# AI画像生成パイロット：品質・原価のオフライン評価

対象は従来のGPT Image 2.5 Flareによる2回試験計画（reference 1枚、iris_l 1枚）です。この変更は**実AI生成・課金・API通信を行いません**。これまでの33パーツ生成・Inochi2Dモデリング・画像1枚からの変換・旧パイロット計画には変更を加えません。

## 目的

- 出力したPNGの構造検査、同一キャラクターの見た目、記録した実費、AI生成元の証拠を混同しない
- データ不足は未実施・nullとして報告し、試験や一般公開の成功を捏造しない
- 1つの虹彩が成功しても33パーツ全体の成功率とはみなさない
- 入力のplan_id、モデル、iris_lのPNG SHA、共通参照のSHAを照合する
- 個人の画像・原価記録はGitの外側に保存する

## 利用法

API実験を別途承認し、実際の生成画像が存在する場合に、既存の check-parts.mjs で quality_report.json を得ます。評価は次のCLIで行います。

    node scripts/ai-image-pilot/assessment.mjs --plan /PRIVATE/pilot_plan.json --structure /PRIVATE/quality_report.json --visual /PRIVATE/reviewer.json --billing /PRIVATE/billing.json --output /PRIVATE/NEW-assessment-dir

--plan と --output 以外は任意。未取得なら not-tested / null として評価し、公開可否は false のままです。新規Git外ディレクトリに assessment.json を保存します。

reviewer.json の例（実際の画像を確認するまで pass にしないこと）：

    {
      "assessor": "human visual reviewer",
      "reference_sha256": "実際のreference.pngの64桁sha256",
      "part_sha256": "quality_report.jsonのsource_sha256",
      "axes": {
        "reference_identity": "not-tested",
        "part_identity": "not-tested",
        "line_and_color": "not-tested",
        "transparent_background": "not-tested",
        "part_alignment": "not-tested",
        "hidden_surface": "not-tested"
      }
    }

各軸は pass / fail / not-tested のみ。全項目 pass の場合でも「人手での見た目の確認」とし、APIの生成元を認証済みとは扱いません。

billing.json の例（料金表の仮定ではなく、実際のダッシュボードまたはAPI usageから人が転記した値のみ）：

    {
      "currency": "USD",
      "reference_usd": 0.12,
      "iris_l_usd": 0.08,
      "source": "dashboard-transcription"
    }

マイクロドルの整数に換算します。手入力した費用は provider_billing_verified:false であり、課金上限の保証にはなりません。

## 成功条件と制限

evidence_complete_for_two_call_review は、虹彩PNGの構造と目視と手入力費用が揃ったことを示すだけです。APIの実行証跡、33パーツ全部、自動リギング、Creatorでの検証、商用公開は含まれません。ready_for_paid_generation と ready_for_general_publication は常に false です。

planPilotMetrics は別々の plan_id の記録だけ集約します。未検査時の成功率はゼロではなく null を返します。AIによる33パーツ生成成功率も null のままです。

追加料金・API呼出し・ログイン情報・画像送信・main統合・一般公開の承認はありません。

テスト：

    node --test scripts/ai-image-pilot/assessment-test.mjs

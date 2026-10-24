// Offline only. No API key is read and no endpoint is contacted.
import {parseArgs} from 'node:util';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createPilotPlan} from '../../server/ai-image-pilot/plan.mjs';
import {createTwoCallPilotPlan} from '../../server/ai-image-pilot/two-call-plan.mjs';
import {costComparison,createBudgetSimulation} from '../../server/ai-image-pilot/cost-control.mjs';
import {createGuidePng} from '../../server/ai-image-pilot/guides.mjs';
import {hashJSON} from '../../shared/character-design.js';
import {readJsonFile,newPrivateDirectory,writePrivate,json} from './private-io.mjs';

const {values}=parseArgs({options:{output:{type:'string'},design:{type:'string'},model:{type:'string'},'legacy-six-call':{type:'boolean',default:false}}});
if(!values.output)throw new Error('Usage: prepare.mjs --output NEW_PRIVATE_DIR [--design character_design.json] [--model MODEL] [--legacy-six-call]. Preparation only; no execute option.');
if(values['legacy-six-call']&&values.model)throw new Error('The legacy plan keeps its original GPT Image 1.5 model.');
const design=values.design?await readJsonFile(values.design,8192):{},legacy=values['legacy-six-call'];
const plan=legacy?await createPilotPlan(design):await createTwoCallPilotPlan(design,{model:values.model}),output=await newPrivateDirectory(values.output);
await mkdir(join(output,'guides'),{mode:0o700});await mkdir(join(output,'requests'),{mode:0o700});
for(const request of plan.requests){
  if(request.part){
    const bytes=createGuidePng(request.part),file=join(output,'guides',request.role+'.png');await writePrivate(file,bytes);
    request.images.find(i=>i.purpose==='geometry-guide-not-character-artwork').sha256=createHash('sha256').update(bytes).digest('hex');
  }
  await writePrivate(join(output,'requests',request.id+'.json'),json(request));
}
const {plan_id,...body}=plan;plan.plan_id=await hashJSON(body);
await writePrivate(join(output,'pilot_plan.json'),json(plan));
const pricingBytes=await readFile(new URL(legacy?'../../server/ai-image-pilot/pricing-status-v1.json':'../../server/ai-image-pilot/pricing-status.json',import.meta.url));
await writePrivate(join(output,'pricing_status.json'),pricingBytes);
if(!legacy){
  await writePrivate(join(output,'cost_comparison.json'),json(costComparison(plan,JSON.parse(pricingBytes))));
  await writePrivate(join(output,'budget_simulation.json'),json(createBudgetSimulation(plan)));
}
const retryText=legacy?`通常${plan.trial_counts.base_requests}回、各1回の追加試行を含め最大${plan.trial_counts.maximum_requests}回。自動再試行は0回。`:'共通参照1回＋左虹彩1回、合計最大2回。再試行・モデル切替の追加呼出しは0回。';
await writePrivate(join(output,'REVIEW_BEFORE_API.md'),`# API実行前の確認資料\n\nこれは送信前の準備だけです。API実行機能は含みません。\n\n- 候補: ${plan.model} / medium / 1024×1024 / 透過PNG / 各n=1。最新・最良という評価ではありません。\n- ${retryText}\n- 現行の公式料金/利用条件は未確認。通常・最大USDとも算定待ち。現在の実行上限0回/0USD。${legacy?'':'提案する予算上限は1.00 USDで、料金見積もりや実行許可ではありません。公式単価と各リクエストの課金上限を確認できるまで送信禁止です。'}\n- 送信予定の全文はrequests/*.json、添付予定はguides/*.pngと承認後にAIが作るraw/reference.png。同じ参照画像のSHAを固定して全パーツに利用します。\n- 以前のユーザー画像、既存モデル、APIキーを含みません。ガイドは青い矩形と支点だけの技術図で、AI素材ではありません。\n- キーは承認後のサーバー環境のOPENAI_API_KEY/秘密管理へ置き、ブラウザ・VITE_*・CLI引数・Git・ログへ保存しません。\n- 正式な価格、入力料金、再試行・タイムアウト、送信内容、保存/学習/商用条件、予算上限の説明後にオーナー承認が必要です。\n- ${legacy?'5パーツ':'虹彩1パーツ'}だけでは33パーツモデルを生成できません。ダミーや既存テンプレートで不足を埋めてAI成功とは扱いません。\n\n${plan.cost.formula}\n\n${plan.cost.limitation}\n`);
console.log(JSON.stringify({output,plan_id:plan.plan_id,model:plan.model,base_requests:plan.trial_counts.base_requests,maximum_requests:plan.trial_counts.maximum_requests,external_requests_sent:0,api_key_read:false,ai_generation_executed:false,current_official_prices_verified:false,estimated_trial_usd:null,maximum_trial_usd:null,...(!legacy?{proposed_ceiling_usd:'1.00',automatic_retries:0}: {})}));

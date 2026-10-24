import {createPilotPlan} from './plan.mjs';
import {modelProfile,DEFAULT_TWO_CALL_MODEL} from './model-profiles.mjs';
import {TWO_CALL_LIMIT,PROPOSED_CEILING_MICROUSD} from './cost-control.mjs';
import {hashJSON} from '../../shared/character-design.js';

export async function createTwoCallPilotPlan(input={},options={}){
  const profile=modelProfile(options.model??DEFAULT_TWO_CALL_MODEL),legacy=await createPilotPlan(input);
  const {plan_id,...plan}=legacy;
  plan.version=2;plan.model=profile.id;plan.model_alias=profile.alias;plan.model_is_snapshot=profile.snapshot;
  plan.model_selection='Use the SAME model for reference and edit. Flare snapshot is the provisional two-call candidate because it is explicitly documented by the current official OpenAPI. No unverified price, speed or quality advantage is asserted. Sunburst is a separate comparison candidate, not an automatic fallback.';
  plan.requests=plan.requests.filter(r=>r.id==='reference'||r.role==='iris_l');
  for(const r of plan.requests){r.fields.model=profile.id;if(r.operation==='edit'){
    if(profile.input_fidelity)r.fields.input_fidelity=profile.input_fidelity;else delete r.fields.input_fidelity;
  }}
  plan.retry_policy={automatic_retries:0,planned_extra_attempts_per_request:0,attempts_include_ambiguous_timeouts:true,
    note:'Maximum two API attempts TOTAL. No retries or model fallbacks. Timeouts may be billed and stop the trial. Any new attempt requires a new reviewed budget and explicit owner authorization.'};
  plan.trial_counts={base_requests:2,maximum_requests:2,base_output_images:2,maximum_output_images:2,base_image_attachments:2,maximum_image_attachments:2};
  plan.budget_policy={maximum_calls:TWO_CALL_LIMIT,proposed_ceiling_microusd:PROPOSED_CEILING_MICROUSD,
    proposed_ceiling_usd:'1.00',currency:'USD',owner_approved:false,permitted_calls:0,permitted_spend_microusd:0,
    reserve_verified_worst_case_before_every_request:true,unknown_prices_or_upper_bound_block_execution:true,
    serialize_and_persist_ledger_before_send:true,automatic_retries:0,
    note:'$1 is a proposed ceiling, not a fee estimate or current spending permission. No API transport exists. Provider-side billing cannot be capped merely by checking usage after a request.'};
  plan.cost={currency:'USD',current_official_prices_verified:false,estimated_trial_usd:null,maximum_trial_usd:null,
    proposed_ceiling_usd:'1.00',permitted_api_calls:0,permitted_spend_usd:0,
    formula:'One reference text-to-image request + one iris layer edit, including edit input images (the reference and geometry guide), text input and image output. Retries allowed: zero, maximum two attempts in total.',
    limitation:'The $1 proposed ceiling is not a verified provider billing maximum. Without verified rates and per-request upper bounds, execution must remain blocked. The reviewed Images API schema has no monetary or max_output_tokens cap.'};
  plan.future_checks=plan.required_checks;
  plan.required_checks=['canonical reference identity and eye placement','left iris and pupil only, no sclera/lashes/skin/highlight','RGBA transparency including within the cropped tile','position and iris completeness behind lids','same color/shading as the frozen reference'];
  plan.review.note='Two-call preparation only: one reference and one iris layer. Not a complete eye, blink rig, 33-part character, AI-quality success or runtime model.';
  return {...plan,plan_id:await hashJSON(plan)};
}

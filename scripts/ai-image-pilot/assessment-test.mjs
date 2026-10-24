import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessTwoCallPilot,planPilotMetrics} from '../../server/ai-image-pilot/assessment.mjs';
const sha='a'.repeat(64),sha2='b'.repeat(64),p={version:2,plan_id:sha,model:'gpt-image-2.5-flare-2026-09-08',
  trial_counts:{maximum_requests:2},requests:[{id:'reference'},{id:'iris_l'}],
  budget_policy:{owner_approved:false},cost:{permitted_api_calls:0}};
const report=(passed=true)=>({format:'ai-live2d-pilot-structure-review',version:1,plan_id:sha,model:p.model,
  parts:[{role:'iris_l',source_sha256:sha2,structure_passed:passed}],all_structure_passed:passed});
const axes=Object.fromEntries(['reference_identity','part_identity','line_and_color','transparent_background','part_alignment','hidden_surface'].map(k=>[k,'pass']));
const visual={assessor:'Human reviewer',reference_sha256:sha,part_sha256:sha2,axes};
const billing={currency:'USD',reference_usd:0.12,iris_l_usd:0.08,source:'dashboard-transcription'};

test('no evidence means no proven success and null aggregate rates',()=>{
  const r=assessTwoCallPilot({plan:p});assert.equal(r.part_structure,'not-tested');
  assert.equal(r.evidence_complete_for_two_call_review,false);assert.equal(r.ready_for_paid_generation,false);
  assert.equal(r.authenticated_ai_provenance_verified,false);assert.equal(r.billing_transcription,null);
  assert.equal(planPilotMetrics([r]).structural_pass_rate,null);
  assert.equal(planPilotMetrics([r]).mean_manually_reported_cost_microusd,null);
});
test('matching image and human review can be documented but never attest AI provenance or publication',()=>{
  const r=assessTwoCallPilot({plan:p,structureReport:report(),visualReview:visual,billing});
  assert.equal(r.part_structure,'passed');assert.equal(r.visual_review.passed,true);
  assert.equal(r.billing_transcription.total_microusd,200000);
  assert.equal(r.evidence_complete_for_two_call_review,true);
  assert.equal(r.ready_for_paid_generation,false);assert.equal(r.ready_for_general_publication,false);
  assert.equal(r.authenticated_ai_provenance_verified,false);assert.equal(r.complete_33_part_batch,false);
  const m=planPilotMetrics([r]);assert.equal(m.structural_pass_rate,1);assert.equal(m.mean_manually_reported_cost_microusd,200000);
  assert.equal(m.ai_generation_success_rate,null);
});
test('reject forged, mixed or mismatched evidence and never repair failed parts',()=>{
  assert.throws(()=>assessTwoCallPilot({plan:{...p,trial_counts:{maximum_requests:3}}}));
  assert.throws(()=>assessTwoCallPilot({plan:{...p,budget_policy:{owner_approved:true}}}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:{...report(),plan_id:sha2}}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:{...report(),all_structure_passed:false}}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:report(false),visualReview:visual}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:report(),visualReview:{...visual,part_sha256:sha}}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:report(),billing:{...billing,reference_usd:-0.12}}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:report(),billing:{...billing,reference_usd:NaN}}));
  assert.throws(()=>assessTwoCallPilot({plan:p,structureReport:report(),billing:{...billing,reference_usd:0.123456789}}));
});
test('an incomplete visual review is not reported as a pass',()=>{
  const review=structuredClone(visual);review.axes.hidden_surface='not-tested';
  const r=assessTwoCallPilot({plan:p,structureReport:report(),visualReview:review});
  assert.equal(r.visual_review.passed,false);assert.equal(r.evidence_complete_for_two_call_review,false);
});
test('aggregate rejects duplicate samples instead of inflating rate',()=>{
  const r=assessTwoCallPilot({plan:p,structureReport:report(false)});
  assert.equal(planPilotMetrics([r]).structural_pass_rate,0);
  assert.throws(()=>planPilotMetrics([r,r]),/distinct/);
});

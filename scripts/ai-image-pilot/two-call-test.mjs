import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createTwoCallPilotPlan} from '../../server/ai-image-pilot/two-call-plan.mjs';
import {validatePilotPlan} from '../../server/ai-image-pilot/plan.mjs';
import {MODEL_PROFILES} from '../../server/ai-image-pilot/model-profiles.mjs';
import {tokenCostMicrousd,costComparison,createBudgetSimulation,reserveSimulationAttempt,settleSimulationAttempt} from '../../server/ai-image-pilot/cost-control.mjs';
import {ROOT} from './private-io.mjs';

const run=promisify(execFile),prepare=join(ROOT,'scripts/ai-image-pilot/prepare.mjs');
const plan=await createTwoCallPilotPlan();
for(const profile of MODEL_PROFILES)test(profile.label+' uses exactly two calls, a shared model/reference and documented parameters',async()=>{
  const p=await createTwoCallPilotPlan({}, {model:profile.alias});assert.equal(p.version,2);assert.equal(p.model,profile.id);
  assert.deepEqual(p.requests.map(r=>r.id),['reference','iris_l']);
  assert.equal(p.requests[0].fields.model,p.requests[1].fields.model);assert.equal(p.requests[1].images[0].asset,p.reference_binding.asset);
  assert.equal(p.requests[1].fields.input_fidelity,profile.input_fidelity??undefined);
  assert.equal(p.trial_counts.maximum_requests,2);assert.equal(p.trial_counts.maximum_image_attachments,2);assert.equal(p.retry_policy.planned_extra_attempts_per_request,0);
  assert.equal(p.budget_policy.proposed_ceiling_microusd,1000000);assert.equal(p.budget_policy.owner_approved,false);assert.equal(p.cost.permitted_api_calls,0);
  assert.equal((await validatePilotPlan(p)).plan_id,p.plan_id);
});

test('unknown models and widened calls, budget, retry or approval states are refused',async()=>{
  await assert.rejects(()=>createTwoCallPilotPlan({}, {model:'gpt-image-unknown'}));
  for(const change of [p=>p.trial_counts.maximum_requests=3,p=>p.budget_policy.proposed_ceiling_microusd=2000000,p=>p.budget_policy.owner_approved=true,p=>p.retry_policy.automatic_retries=1,p=>p.requests[1].fields.input_fidelity='high']){
    const p=structuredClone(plan);change(p);await assert.rejects(()=>validatePilotPlan(p));
  }
});

test('monetary calculation uses integer microUSD, includes all modalities and never treats unknown prices as free',()=>{
  // Synthetic arithmetic rates, not actual GPT Image prices.
  assert.equal(tokenCostMicrousd({text_input:10,image_input:20,image_output:30},{text_input:'1',image_input:'2',image_output:'3'}),140);
  assert.equal(tokenCostMicrousd({text_input:1,image_input:0,image_output:0},{text_input:'0.1',image_input:'0',image_output:'0'}),1);
  assert.throws(()=>tokenCostMicrousd({text_input:1,image_input:0,image_output:1},{text_input:null,image_input:'0',image_output:'1'}));
  assert.throws(()=>tokenCostMicrousd({text_input:-1,image_input:0,image_output:1},{text_input:'1',image_input:'0',image_output:'1'}));
});

test('unverified rates and missing usage block estimates; a synthetic complete quote still cannot authorize API execution',async()=>{
  const sheet=JSON.parse(await readFile(join(ROOT,'server/ai-image-pilot/pricing-status.json'),'utf8'));
  const missing=costComparison(plan,sheet);assert.equal(missing.models.length,3);
  for(const r of missing.models){assert.equal(r.estimated_trial_microusd,null);assert.equal(r.maximum_trial_microusd,null);assert.equal(r.within_proposed_ceiling,false);}
  const row=structuredClone(sheet.models[1]);row.current_official_prices_verified=true;
  row.rates_usd_per_million_tokens={text_input:'1',image_input:'2',image_output:'3'};
  row.usage_assumptions={reference:{text_input:10,image_input:0,image_output:30},eye_part:{text_input:10,image_input:20,image_output:30}};
  row.verified_request_upper_bounds={verified:true,source_url:'https://example.invalid/test-fixture-not-real-pricing',reference_microusd:500000,eye_part_microusd:500000};
  const r=costComparison(plan,{models:[row]}).models[0];assert.equal(r.estimated_trial_microusd,240);assert.equal(r.maximum_trial_microusd,1000000);assert.equal(r.within_proposed_ceiling,true);assert.equal(r.api_execution_permitted,false);
});

const reservation=n=>({maximum_cost_microusd:n,upper_bound_verified:true});
test('budget simulation reserves before sending and caps the whole trial at two attempts and one USD',()=>{
  let state=createBudgetSimulation(plan);
  assert.throws(()=>reserveSimulationAttempt(state,'reference',{maximum_cost_microusd:100,upper_bound_verified:false}));
  assert.throws(()=>reserveSimulationAttempt(state,'iris_l',reservation(1)));
  const next=reserveSimulationAttempt(state,'reference',reservation(600000));assert.equal(state.attempts.length,0);state=next;
  assert.throws(()=>reserveSimulationAttempt(state,'reference',reservation(1)));
  state=settleSimulationAttempt(state,1,{outcome:'complete',actual_microusd:600000});
  assert.throws(()=>reserveSimulationAttempt(state,'iris_l',reservation(400001)),/monetary/);
  state=reserveSimulationAttempt(state,'iris_l',reservation(400000));state=settleSimulationAttempt(state,2,{outcome:'complete',actual_microusd:400000});
  assert.equal(state.spent_microusd,1000000);assert.equal(state.attempts.length,2);assert.throws(()=>reserveSimulationAttempt(state,'reference',reservation(1)),/two-call/);
});

test('timeouts keep the full reservation and stop instead of refunding or silently retrying',()=>{
  let state=reserveSimulationAttempt(createBudgetSimulation(plan),'reference',reservation(600000));
  state=settleSimulationAttempt(state,1,{outcome:'timeout-or-unknown'});
  assert.equal(state.held_microusd,600000);assert.equal(state.attempts.length,1);assert.equal(state.halted,true);
  assert.throws(()=>reserveSimulationAttempt(state,'reference',reservation(1)),/halted/);
});

test('unexpected usage over the reserved amount is recorded and halts the simulation without hiding the incident',()=>{
  let state=reserveSimulationAttempt(createBudgetSimulation(plan),'reference',reservation(100));
  state=settleSimulationAttempt(state,1,{outcome:'complete',actual_microusd:200});assert.equal(state.spent_microusd,200);assert.equal(state.halted,true);
  assert.throws(()=>reserveSimulationAttempt(state,'iris_l',reservation(1)),/halted/);
});

test('new default CLI creates a two-call plan and cost controls; all three models remain selectable offline',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'openai-two-call-test-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  for(const [index,profile] of MODEL_PROFILES.entries()){
    const output=join(temp,'model-'+index),args=[prepare,'--output',output];if(index!==1)args.push('--model',profile.alias);
    const result=await run(process.execPath,args,{cwd:ROOT});const receipt=JSON.parse(result.stdout);assert.equal(receipt.maximum_requests,2);assert.equal(receipt.model,profile.id);assert.equal(receipt.external_requests_sent,0);assert.equal(receipt.api_key_read,false);
    const p=await validatePilotPlan(JSON.parse(await readFile(join(output,'pilot_plan.json'),'utf8')));assert.equal(p.version,2);
    assert.equal((await readdir(join(output,'guides'))).length,1);assert.equal((await readdir(join(output,'requests'))).length,2);
    const comparison=JSON.parse(await readFile(join(output,'cost_comparison.json'),'utf8'));assert.equal(comparison.models.length,3);assert.equal(comparison.external_execution_authorized,false);
    const simulation=JSON.parse(await readFile(join(output,'budget_simulation.json'),'utf8'));assert.equal(simulation.simulation_only,true);assert.equal(simulation.attempts.length,0);
  }
  await assert.rejects(()=>run(process.execPath,[prepare,'--output',join(temp,'unknown'),'--model','bad'],{cwd:ROOT}));
});

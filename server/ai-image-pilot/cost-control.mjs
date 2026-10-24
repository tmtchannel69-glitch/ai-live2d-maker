// Offline accounting primitives only. There is no API executor or approval
// token here. A production worker must persist reservations atomically BEFORE
// sending, verify its quote/upper bounds and obtain owner authorization.
export const TWO_CALL_LIMIT=2;
export const PROPOSED_CEILING_MICROUSD=1_000_000; // $1 proposal, not a quote or authorization
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const integer=(n,label)=>{need(Number.isSafeInteger(n)&&n>=0,label+' must be a nonnegative safe integer.');return n;};
const ceilDiv=(a,b)=>(a+b-1n)/b;
function decimalRate(value){
  need(typeof value==='string'&&/^\d{1,6}(\.\d{1,6})?$/.test(value),'A verified decimal USD-per-million rate is required; null is not zero.');
  const [whole,fraction='']=value.split('.');return BigInt(whole)*1_000_000n+BigInt(fraction.padEnd(6,'0'));
}
export function tokenCostMicrousd(usage,rates){
  let total=0n;
  for(const key of ['text_input','image_input','image_output'])total+=BigInt(integer(usage?.[key],key+' tokens'))*decimalRate(rates?.[key]);
  const result=ceilDiv(total,1_000_000n);need(result<=BigInt(Number.MAX_SAFE_INTEGER),'Cost exceeds safe integer range.');return Number(result);
}
export function costComparison(plan,sheet){
  return {format:'ai-live2d-two-call-cost-comparison',version:1,plan_id:plan.plan_id,base_calls:2,maximum_calls_including_retries:2,
    proposed_ceiling_microusd:PROPOSED_CEILING_MICROUSD,external_execution_authorized:false,
    models:sheet.models.map(row=>{
      let estimate=null,maximum=null,reason='Current official prices and token usage assumptions are not verified.';
      if(row.current_official_prices_verified===true){
        try{estimate=tokenCostMicrousd(row.usage_assumptions.reference,row.rates_usd_per_million_tokens)+tokenCostMicrousd(row.usage_assumptions.eye_part,row.rates_usd_per_million_tokens);}catch{reason='A complete text/image input and output usage estimate is required.';}
        const upper=row.verified_request_upper_bounds;
        if(upper?.verified===true&&typeof upper.source_url==='string'&&upper.source_url.startsWith('https://')){
          try{maximum=integer(upper.reference_microusd,'Reference upper bound')+integer(upper.eye_part_microusd,'Eye edit upper bound');integer(maximum,'Total upper bound');}catch{maximum=null;}
        }
        if(estimate!==null&&maximum!==null)reason=maximum<=PROPOSED_CEILING_MICROUSD?'Quote fits the proposed ceiling. Owner authorization and a production executor are still absent.':'Blocked: verified maximum exceeds the proposed ceiling.';
      }
      return {model:row.model,current_official_prices_verified:row.current_official_prices_verified,estimated_trial_microusd:estimate,
        maximum_trial_microusd:maximum,within_proposed_ceiling:maximum!==null&&maximum<=PROPOSED_CEILING_MICROUSD,
        reason,api_execution_permitted:false};
    })};
}

export function createBudgetSimulation(plan){
  need(plan?.version===2&&plan.trial_counts.maximum_requests===2,'Use a validated two-call plan.');
  return {format:'ai-live2d-pilot-budget-simulation',version:1,simulation_only:true,plan_id:plan.plan_id,
    maximum_calls:TWO_CALL_LIMIT,ceiling_microusd:PROPOSED_CEILING_MICROUSD,spent_microusd:0,held_microusd:0,halted:false,attempts:[]};
}
export function reserveSimulationAttempt(ledger,job,reservation){
  need(ledger?.simulation_only===true&&ledger.maximum_calls===2&&ledger.ceiling_microusd===PROPOSED_CEILING_MICROUSD,'Invalid budget simulation policy.');
  need(!ledger.halted,'Trial is halted; unresolved billing or a limit violation blocks further attempts.');
  need(['reference','iris_l'].includes(job),'Unknown pilot job.');
  need(ledger.attempts.length<TWO_CALL_LIMIT,'The two-call limit includes failed requests and retries.');
  need(!ledger.attempts.some(a=>a.job===job),'Retries are disabled in this two-call trial.');
  need(job==='reference'||ledger.attempts.some(a=>a.job==='reference'&&a.status==='complete'),'Finish the reference before the eye edit.');
  need(reservation?.upper_bound_verified===true,'No request can be reserved without a verified billing upper bound.');
  const amount=integer(reservation.maximum_cost_microusd,'Reservation');
  need(amount>0,'A request reservation must include its input and output cost.');
  need(ledger.spent_microusd+ledger.held_microusd+amount<=ledger.ceiling_microusd,'The monetary ceiling would be exceeded.');
  const next=structuredClone(ledger);next.held_microusd+=amount;
  next.attempts.push({id:next.attempts.length+1,job,status:'reserved',reserved_microusd:amount,actual_microusd:null});return next;
}
export function settleSimulationAttempt(ledger,id,{outcome,actual_microusd=null}){
  need(ledger?.simulation_only===true,'Simulation ledger required.');const next=structuredClone(ledger),a=next.attempts.find(a=>a.id===id);
  need(a?.status==='reserved','Settle each reserved attempt once.');
  if(outcome==='timeout-or-unknown'){
    a.status='unknown';next.halted=true;return next; // keep full reservation, no refund/retry
  }
  need(['complete','failed'].includes(outcome),'Unknown attempt outcome.');
  integer(actual_microusd,'Observed cost');a.status=outcome;a.actual_microusd=actual_microusd;
  next.held_microusd-=a.reserved_microusd;next.spent_microusd+=actual_microusd;
  if(outcome==='failed'||actual_microusd>a.reserved_microusd||next.spent_microusd+next.held_microusd>next.ceiling_microusd){
    next.halted=true;next.incident='Failure or unexpected billing: record the actual cost and stop, never conceal an overrun.';
  }return next;
}

import {validateDeforms} from './expression-deform.js';

// Operate on one endpoint only. Validate the complete interpolation, not just
// the endpoint, and reject out-of-range edits instead of clamping nine points.
export function adjustShape(setting,key,action,role,assets){
  if(!['closed','open'].includes(key))throw new Error('編集する形が正しくありません。');
  const next=structuredClone(setting),points=next[key];
  if(action==='copy')next[key]=structuredClone(next[key==='closed'?'open':'closed']);
  else{
    const cx=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,cy=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
    const sx=action==='narrow'?.95:action==='widen'?1.05:1,sy=action==='thin'?.95:action==='thicken'?1.05:1;
    const dx=action==='left'?-.005:action==='right'?.005:0,dy=action==='up'?-.005:action==='down'?.005:0;
    if(!['narrow','widen','thin','thicken','left','right','up','down'].includes(action))throw new Error('形の調整方法が正しくありません。');
    next[key]=points.map(([x,y])=>[cx+(x-cx)*sx+dx,cy+(y-cy)*sy+dy]);
  }
  validateDeforms({[role]:next},assets);return next;
}

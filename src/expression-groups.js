import {EXPRESSION_ROLE_IDS} from './expression-assets.js';

export const GROUP_LABELS={face:'顔全体',left_eye:'左目（画面右）',right_eye:'右目（画面左）',mouth:'口'};
export const GROUP_IDS=Object.keys(GROUP_LABELS);
export const emptyGroups=()=>({transforms:{},assignments:{},clipFollow:{}});
export const defaultGroupTransform=()=>({dx:0,dy:0,pivotX:.5,pivotY:.5,angle:0,scale:1});
export const hasGroups=s=>Object.values(s).some(v=>Object.keys(v).length);
const limits={dx:[-1,1],dy:[-1,1],pivotX:[0,1],pivotY:[0,1],angle:[-180,180],scale:[.1,4]};
export function validateGroups(value,assets,clips) {
  const fail=()=>{throw new Error('素材をまとめて動かす設定が正しくありません。所属・表示範囲・位置や倍率を確認してください。');};
  const record=v=>v && typeof v==='object' && !Array.isArray(v);
  if(!record(value) || Object.keys(value).sort().join(',')!=='assignments,clipFollow,transforms' || !Object.values(value).every(record))fail();
  for(const [id,s] of Object.entries(value.transforms)) {
    if(!GROUP_IDS.includes(id) || !record(s) || Object.keys(s).sort().join(',')!=='angle,dx,dy,pivotX,pivotY,scale')fail();
    for(const [k,[min,max]] of Object.entries(limits))if(typeof s[k]!=='number' || !Number.isFinite(s[k]) || s[k]<min || s[k]>max)fail();
  }
  const validRole=role=>EXPRESSION_ROLE_IDS.includes(role) && assets.some(a=>a.role===role);
  for(const [role,id] of Object.entries(value.assignments))if(!validRole(role) || !GROUP_IDS.includes(id))fail();
  for(const [role,follow] of Object.entries(value.clipFollow))if(!validRole(role) || follow!==true || !value.assignments[role] || !clips[role])fail();
  return structuredClone(value);
}
export function pruneGroups(value,assets,clips) {
  const next=structuredClone(value);
  for(const role of Object.keys(next.assignments))if(!assets.some(a=>a.role===role))delete next.assignments[role];
  for(const role of Object.keys(next.clipFollow))if(!next.assignments[role] || !clips[role])delete next.clipFollow[role];
  return next;
}
export function suggestedAssignments(assets) {
  return Object.fromEntries(assets.map(({role})=>[role,role.startsWith('eye_')?(role.endsWith('_l')?'left_eye':'right_eye'):role.startsWith('mouth_')?'mouth':'face']));
}
export const IDENTITY=[1,0,0,1,0,0];
export function multiply(a,b) {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
export const transformPoint=(m,[x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function inversePoint(m,[x,y],vector=false) {
  const det=m[0]*m[3]-m[1]*m[2],px=x-(vector?0:m[4]),py=y-(vector?0:m[5]);
  return [(m[3]*px-m[2]*py)/det,(-m[1]*px+m[0]*py)/det];
}
export function localMatrix(s,width,height) {
  const radians=s.angle*Math.PI/180,a=Math.cos(radians)*s.scale,b=Math.sin(radians)*s.scale,x=s.pivotX*width,y=s.pivotY*height;
  return [a,b,-b,a,s.dx*width+x-a*x+b*y,s.dy*height+y-b*x-a*y];
}
export function groupMatrix(groups,id,width,height) {
  if(!id)return IDENTITY;
  const local=localMatrix(groups.transforms[id]||defaultGroupTransform(),width,height);
  return id==='face'?local:multiply(localMatrix(groups.transforms.face||defaultGroupTransform(),width,height),local);
}
export const parentMatrix=(groups,id,width,height)=>id==='face'?IDENTITY:groupMatrix(groups,'face',width,height);
export const groupMembers=(groups,id,assets)=>assets.filter(a=>groups.assignments[a.role] && (id==='face' || groups.assignments[a.role]===id));
export function groupBounds(groups,id,assets,width,height) {
  const points=groupMembers(groups,id,assets).flatMap(a=>{
    const p=a.placement,m=groupMatrix(groups,groups.assignments[a.role],width,height);
    return [[p.x,p.y],[p.x+p.width,p.y],[p.x+p.width,p.y+p.height],[p.x,p.y+p.height]].map(([x,y])=>transformPoint(m,[x*width,y*height]));
  });
  if(!points.length)return null;
  return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
}

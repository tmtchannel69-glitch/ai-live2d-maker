import {buildDesignedInochi,buildGeneratedInochi,packGeneratedContainer} from './generated-character-inochi.js';
import {MAKER_RIG_PROFILE,MAKER_PARAMETERS} from './modular-character.js';
import {auditModularMeshes} from './modular-mesh-audit.js';
const signature=[84,82,78,83,82,84,83,0];
// Limited to our own generated legacy PNG containers, not arbitrary INP/INP2.
export function readModularContainer(bytes){
  const need=(v,m)=>{if(!v)throw new Error(m||'生成モデルの構造が正しくありません。');};
  need(bytes instanceof Uint8Array&&bytes.length<=16*1024*1024&&signature.every((v,i)=>bytes[i]===v));
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=8;
  const uint=()=>{need(at+4<=bytes.length);const n=view.getUint32(at);at+=4;return n;};
  const take=n=>{need(n>=0&&at+n<=bytes.length);const b=bytes.subarray(at,at+n);at+=n;return b;};
  const count=uint();need(count>0&&count<=2*1024*1024);
  const model=JSON.parse(new TextDecoder().decode(take(count)));need(new TextDecoder().decode(take(8))==='TEX_SECT');
  need(uint()===33);const textures=[];
  for(let i=0;i<33;i++){const n=uint();need(n>=33&&n<=4*1024*1024&&take(1)[0]===0);textures.push(take(n));}
  need(at===bytes.length);return {model,textures};
}
export async function buildModularRig(manifest,assets,{signal}={}){
  const bytes=new Map();for(const [role,blob] of assets)bytes.set(role,new Uint8Array(await blob.arrayBuffer()));
  const original=await (manifest.version===2?buildDesignedInochi(manifest,bytes,{signal}):buildGeneratedInochi(manifest,bytes,{signal}));
  const model=structuredClone(original.model),find=n=>n.name==='group_body'?n:n.children.map(find).find(Boolean),body=find(model.nodes);
  if(!body)throw new Error('共通動作に必要な胴体グループがありません。');
  const binding=(param_name,values)=>({node:body.uuid,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});
  model.param.push({uuid:1100,name:'Breath',is_vec2:false,min:[0,0],max:[1,1],defaults:[0,0],axis_points:[[0,.5,1],[0]],
    bindings:[binding('transform.s.x',[1,1.0015,1.003]),binding('transform.s.y',[1,1.002,1.004]),binding('transform.t.y',[0,-.5,-1])]});
  const inp=packGeneratedContainer(model,readModularContainer(original.inp).textures);
  const meshAudit=auditModularMeshes(model);
  const report={...original.report,profile:MAKER_RIG_PROFILE,base_rig_profile:original.report.profile,
    parameters:model.param.map(p=>({name:p.name,min:p.min[0],max:p.max[0],default:p.defaults[0]})),
    breathing:{parameter:'Breath',kind:'small-body-transform',automatic_native_playback:false,naturalness_verified:false},mesh_audit:meshAudit,
    limitations:[...original.report.limitations,'Breath is a reusable control; automatic idle playback is an app preview, not native SDK automation.']};
  for(const [name,[min,max,value]] of Object.entries(MAKER_PARAMETERS)){
    const p=model.param.find(p=>p.name===name);if(!p||p.min[0]!==min||p.max[0]!==max||p.defaults[0]!==value)throw new Error('共通動作が失われました: '+name);
  }
  return {...original,inp,inx:inp.slice(),model,report,rig:{...original.rig,profile:MAKER_RIG_PROFILE,parameters:structuredClone(model.param)}};
}

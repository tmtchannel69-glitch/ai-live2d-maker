// Engine-independent generated layers. Unlike observed image partitions,
// these are intentionally complete overlapping parts in canvas pixels.
export const GENERATED_ROLES=Object.freeze([
  'face_base','ear_l','ear_r','eye_white_l','eye_white_r','iris_l','iris_r','highlight_l','highlight_r',
  'eyelid_upper_l','eyelid_upper_r','eyelid_lower_l','eyelid_lower_r','eyelashes_l','eyelashes_r',
  'brow_l','brow_r','mouth_base','mouth_inside','bangs_front','side_hair_l','side_hair_r','back_hair',
  'neck','torso','shoulder_l','shoulder_r','dress_base','collar','ribbon','sleeve_l','sleeve_r','apron',
]);
export const FORMAT='ai-live2d-generated-character';
export const TEMPLATE_ID='maid-bust-front-v1';
export const MAX_DECODED_PART_BYTES=16*1024*1024;
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const pair=p=>Array.isArray(p)&&p.length===2&&p.every(finite);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);

export function validateRecipe(value={}){
  need(object(value)&&Object.keys(value).every(k=>['template','version','provider','hair','eyes','background'].includes(k)),'生成設定の項目が正しくありません。');
  const r={template:TEMPLATE_ID,version:1,provider:'template',hair:'lavender',eyes:'violet',background:'transparent',...value};
  need(r.template===TEMPLATE_ID&&r.version===1,'このテンプレートの版には対応していません。');
  need(['template','dummy'].includes(r.provider),'この生成方式には対応していません。');
  need(['lavender','silver','brown'].includes(r.hair)&&['violet','blue','amber'].includes(r.eyes),'髪・瞳の色を選び直してください。');
  need(['transparent','white','lavender'].includes(r.background),'背景の設定が正しくありません。');
  return r;
}

export function validateCharacterManifest(m){
  need(object(m)&&m.format===FORMAT&&m.version===1,'キャラクター生成形式の版1が必要です。');
  need(m.coordinates==='canvas-pixels-top-left'&&m.sides==='character-personal-left-right','座標と左右の基準が正しくありません。');
  need(m.canvas?.width===768&&m.canvas?.height===1024,'MVPのキャンバスは768×1024です。');
  need(object(m.generator?.recipe)&&['template','version','provider','hair','eyes','background'].every(k=>k in m.generator.recipe),'再生成設定が不足しています。');
  const recipe=validateRecipe(m.generator.recipe);
  need(m.generator?.id===recipe.provider&&m.generator?.version===1&&m.generator?.ai_generated===false,'生成方式の記録が一致しません。');
  need(m.preview==='preview.png'&&m.background===recipe.background,'プレビューの設定が一致しません。');
  need(m.template===TEMPLATE_ID&&m.scope?.pose==='front'&&m.scope?.crop==='bust'&&m.scope?.costume==='maid'&&m.scope?.expression==='neutral'&&m.scope?.person_count===1&&m.rigged===false&&m.appearance_quality_passed===false,'テンプレートの対象範囲が一致しません。');
  need(Array.isArray(m.groups)&&m.groups.length>0&&m.groups.length<=16,'親子グループが正しくありません。');
  const groups=new Map(m.groups.map(g=>[g?.id,g]));
  need(groups.size===m.groups.length&&groups.has('root'),'グループが重複、またはrootがありません。');
  for(const g of m.groups){
    need(typeof g.id==='string'&&/^(group_[a-z_]+|root)$/.test(g.id)&&pair(g.anchor)&&g.anchor[0]>=0&&g.anchor[0]<=m.canvas.width&&g.anchor[1]>=0&&g.anchor[1]<=m.canvas.height,'グループの支点が正しくありません。');
    need(g.id==='root'?g.parent===null:groups.has(g.parent),'グループの親が見つかりません。');
    const seen=new Set();let n=g;while(n){need(!seen.has(n.id),'親子関係が循環しています。');seen.add(n.id);n=groups.get(n.parent);}
  }
  need(Array.isArray(m.parts)&&m.parts.length===GENERATED_ROLES.length,'指定の33パーツが必要です。');
  const parts=new Map(m.parts.map(p=>[p?.role,p]));
  need(parts.size===GENERATED_ROLES.length&&GENERATED_ROLES.every(r=>parts.has(r)),'役割が不足または重複しています。');
  let bytes=0;const orders=new Set();
  for(const p of m.parts){
    need(p.id===p.role&&p.file===`parts/${p.role}.png`&&groups.has(p.parent),'パーツのファイルまたは親が正しくありません。');
    const q=p.rect;need(object(q)&&['x','y','width','height'].every(k=>Number.isInteger(q[k]))&&q.x>=0&&q.y>=0&&q.width>0&&q.height>0&&q.x+q.width<=m.canvas.width&&q.y+q.height<=m.canvas.height,'パーツの配置がキャンバス外です。');
    need(pair(p.anchor)&&p.anchor[0]>=q.x&&p.anchor[0]<=q.x+q.width&&p.anchor[1]>=q.y&&p.anchor[1]<=q.y+q.height,'パーツの支点が領域外です。');
    need(Number.isInteger(p.order)&&!orders.has(p.order)&&typeof p.enabled_in_neutral==='boolean','パーツの前後順または初期表示が正しくありません。');orders.add(p.order);
    need(p.side===(p.role.endsWith('_l')?'l':p.role.endsWith('_r')?'r':null),'本人基準の左右が一致しません。');
    need(p.clip_to===null||p.clip_to===`eye_white_${p.side}`&&p.clip_to!==p.role&&parts.has(p.clip_to),'白目のクリップ参照が正しくありません。');
    need(typeof p.label==='string'&&p.label.length>0&&p.label.length<=80,'パーツ名が正しくありません。');
    bytes+=q.width*q.height*4;
  }
  need(bytes<=MAX_DECODED_PART_BYTES,'パーツの展開サイズが上限を超えています。');
  return m;
}

function mesh(p){
  const verts=[],uvs=[],indices=[];const {x,y,width:w,height:h}=p.rect;
  for(let j=0;j<3;j++)for(let i=0;i<3;i++){verts.push(x+i*w/2-p.anchor[0],y+j*h/2-p.anchor[1]);uvs.push(i/2,j/2);}
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){const n=j*3+i;indices.push(n,n+1,n+4,n,n+4,n+3);}
  return {verts,uvs,indices,origin:[0,0]};
}

export function createRigMetadata(manifest){
  const m=validateCharacterManifest(manifest);
  return {format:'ai-live2d-generated-rig-metadata',version:1,coordinates:m.coordinates,template:m.generator.recipe.template,
    sides:m.sides,groups:structuredClone(m.groups),parts:m.parts.map(p=>({role:p.role,parent:p.parent,anchor:[...p.anchor],rect:{...p.rect},order:p.order,clip_to:p.clip_to,mesh:mesh(p)})),
    rest_pose_only:true,motion_keys:[],physics:[],runtime_verified:false,appearance_quality_passed:false};
}

export function createInochiIntermediate(manifest){
  const m=validateCharacterManifest(manifest),ids=new Map([...m.groups.map(g=>g.id),...m.parts.map(p=>p.id)].map((id,i)=>[id,i+1]));
  const groups=new Map(m.groups.map(g=>[g.id,g]));const transform=(x,y)=>({trans:[x,y,0],rot:[0,0,0],scale:[1,1]});
  const nodes=m.groups.map(g=>({id:g.id,uuid:ids.get(g.id),parent:g.parent,type:'Node',transform:g.parent?transform(g.anchor[0]-groups.get(g.parent).anchor[0],g.anchor[1]-groups.get(g.parent).anchor[1]):transform(0,0)}));
  for(const p of m.parts){const g=groups.get(p.parent);nodes.push({id:p.id,uuid:ids.get(p.id),parent:p.parent,type:'Part',texture:p.file,
    transform:transform(p.anchor[0]-g.anchor[0],p.anchor[1]-g.anchor[1]),zsort:-p.order,opacity:p.enabled_in_neutral?1:0,
    mesh:mesh(p),masks:p.clip_to?[{source:ids.get(p.clip_to),mode:'Mask'}]:[]});}
  return {format:'ai-live2d-generated-inochi-source',version:1,target:{sdk:'0.8.6',container:'legacy-inp-inx'},
    coordinates:'model-centered-y-down',canvas:m.canvas,origin:groups.get('root').anchor,nodes,
    texture_encoding:'straight-rgba-png; premultiplication-required-before-legacy-storage',
    native_model:false,runtime_verified:false,cubism_compatible:false,
    pending:['texture-serialization','blink-and-motion-keys','native-export','official-creator-validation']};
}

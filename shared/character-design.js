// One immutable design/placement plan for a whole character, never 33 unrelated
// prompts. Existing SVG anatomy is the local reference, not an AI response.
import {createTemplateManifest} from '../src/character-generation/template.js';

export const DESIGN_FORMAT='ai-live2d-character-design';
export const DESIGN_TEMPLATE='front-bust-design-v1';
export const DESIGN_CHOICES=Object.freeze({hair:['long-straight','bob'],eyes:['round','almond','slanted'],face:['soft','oval'],outfit:['classic-maid','cafe-maid'],mood:['gentle','bright','cool']});
const need=(v,s)=>{if(!v)throw new Error(s);};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>need(obj(v)&&Object.keys(v).every(k=>allowed.includes(k)),'デザインの項目が正しくありません。');
const color=v=>{need(typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v),'色は6桁のカラーコードで指定してください。');return v.toLowerCase();};
const choice=(v,name)=>{need(DESIGN_CHOICES[name].includes(v),'対応しているデザイン項目を選んでください。');return v;};
export const hashJSON=async value=>{
  need(globalThis.crypto?.subtle,'デザインを識別できません。HTTPSまたは同じ端末のlocalhostで開いてください。');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
};

export function normalizeDesign(input={}){
  keys(input,['format','version','name','features','style','background']);
  need((input.format??DESIGN_FORMAT)===DESIGN_FORMAT&&(input.version??1)===1,'デザイン形式の版1が必要です。');
  const f=input.features??{};keys(f,['hair','eyes','face','outfit','mood']);
  for(const [k,allowed] of [['hair',['style','color']],['eyes',['shape','color']],['face',['shape','skin']],['outfit',['style','color','accent']]])keys(f[k]??{},allowed);
  const s=input.style??{};keys(s,['ink','line_width','shading','lighting']);
  const name=(input.name??'新しいキャラクター').trim();need(name.length>0&&name.length<=60,'名前は1〜60文字にしてください。');
  const ink=color(s.ink??'#403042');need(Math.max(...[1,3,5].map(i=>parseInt(ink.slice(i,i+2),16)))<=140,'まつ毛を識別できる濃い線の色を選んでください。');
  const line=s.line_width??2;need(Number.isFinite(line)&&line>=1.5&&line<=2.5,'線の太さは1.5〜2.5です。');
  need((s.shading??'soft-cel')==='soft-cel'&&(s.lighting??'upper-left')==='upper-left','この版は共通のセル塗りと左上の光に対応します。');
  const background=input.background??'transparent';need(['transparent','white','lavender'].includes(background),'背景の指定が正しくありません。');
  return {format:DESIGN_FORMAT,version:1,name,features:{
    hair:{style:choice(f.hair?.style??'long-straight','hair'),color:color(f.hair?.color??'#b6a4d9')},
    eyes:{shape:choice(f.eyes?.shape??'round','eyes'),color:color(f.eyes?.color??'#8065bd')},
    face:{shape:choice(f.face?.shape??'soft','face'),skin:color(f.face?.skin??'#ffe5db')},
    outfit:{style:choice(f.outfit?.style??'classic-maid','outfit'),color:color(f.outfit?.color??'#302d41'),accent:color(f.outfit?.accent??'#b5a0d8')},mood:choice(f.mood??'gentle','mood')},
    style:{ink,line_width:line,shading:'soft-cel',lighting:'upper-left'},background};
}

export function mixColor(a,b,t){
  return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
}
export const point=(m,[x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function around([x,y],sx=1,sy=1,angle=0){const c=Math.cos(angle),s=Math.sin(angle),a=c*sx,b=s*sx,d=c*sy,e=-s*sy;return [a,b,e,d,x-a*x-e*y,y-b*x-d*y];}
const rounded=p=>p.map(v=>Math.round(v*1000)/1000);
function transformedRect(q,m){
  const p=[[q.x,q.y],[q.x+q.width,q.y],[q.x,q.y+q.height],[q.x+q.width,q.y+q.height]].map(p=>point(m,p));
  const x=Math.floor(Math.min(...p.map(p=>p[0]))),y=Math.floor(Math.min(...p.map(p=>p[1])));
  return {x,y,width:Math.ceil(Math.max(...p.map(p=>p[0])))-x,height:Math.ceil(Math.max(...p.map(p=>p[1])))-y};
}

export async function createDesignPlan(input={}){
  const design=normalizeDesign(input),id=await hashJSON(design),base=createTemplateManifest(),f=design.features;
  const fx=f.face.shape==='soft'?1.055:.95,fy=f.face.shape==='soft'?.965:1.045;
  const head=around([384,350],fx,fy),eyeSX=f.eyes.shape==='round'?1.035:.99,eyeSY=f.eyes.shape==='round'?1.11:f.eyes.shape==='almond'?.81:.91;
  const neckTop=point(head,[384,505])[1],neckSY=(664-neckTop)/(664-505),neck=around([384,664],fx,neckSY);
  const transforms={};
  for(const p of base.parts){
    let m=[1,0,0,1,0,0];
    if(p.parent==='group_head'||p.parent==='group_mouth'||p.parent==='group_hair'||p.parent.startsWith('group_eye'))m=head;
    if(p.parent.startsWith('group_eye')){
      const pivot=base.groups.find(g=>g.id===p.parent).anchor;
      m=multiply(head,around(pivot,eyeSX,eyeSY,f.eyes.shape==='slanted'?(p.side==='l'?-.055:.055):0));
    }
    if(p.role.startsWith('brow_'))m=multiply(head,around(p.anchor,1,1,(f.mood==='cool'?.045:f.mood==='bright'?-.035:0)*(p.side==='l'?1:-1)));
    if(f.hair.style==='bob'&&['back_hair','side_hair_l','side_hair_r'].includes(p.role))m=multiply(head,around(p.anchor,1,p.role==='back_hair'?.62:.55));
    if(p.role==='neck')m=neck;
    if(f.outfit.style==='cafe-maid'){
      if(p.role.startsWith('sleeve_'))m=around(p.anchor,.98,.82);
      if(p.role==='collar')m=around(p.anchor,1.06,1);
      if(p.role==='ribbon')m=around(p.anchor,.84,.84);
      if(p.role==='apron')m=around(p.anchor,.94,1);
    }
    // A canonical serialized plan must not encode platform-specific last-bit
    // differences in sin/cos. This is coordinate precision, not authentication.
    transforms[p.role]=m.map(v=>Math.round(v*1e9)/1e9);
  }
  const parts=base.parts.map(p=>({...structuredClone(p),rect:transformedRect(p.rect,transforms[p.role]),anchor:rounded(point(transforms[p.role],p.anchor)),
    generation:{design_id:id,source_role:p.role,reference_transform:transforms[p.role],complete_layer:true,completion:'draw-full-hidden-anatomy',
      occluded_by:p.role==='face_base'?['bangs_front','side_hair_l','side_hair_r']:p.role==='back_hair'?['face_base','torso','dress_base']:p.clip_to?['eyelid_upper_'+p.side,'eyelashes_'+p.side]:[]}}));
  const groups=base.groups.map(g=>({...g,anchor:rounded(g.id==='group_head'||g.id.startsWith('group_eye')||['group_hair','group_mouth'].includes(g.id)?point(head,g.anchor):g.anchor)}));
  const pivot=groups.find(g=>g.id==='group_head').anchor,follow=point(head,[384,548])[1],fixed=base.parts.find(p=>p.role==='collar').rect.y+4;
  const eyeSpan=groups.find(g=>g.id==='group_eye_l').anchor[0]-groups.find(g=>g.id==='group_eye_r').anchor[0];
  const palette={hair:{base:f.hair.color,light:mixColor(f.hair.color,'#ffffff',.52),dark:mixColor(f.hair.color,design.style.ink,.55)},
    eyes:{base:f.eyes.color,light:mixColor(f.eyes.color,'#ffffff',.5),dark:mixColor(f.eyes.color,design.style.ink,.6)},
    skin:{base:f.face.skin,light:mixColor(f.face.skin,'#ffffff',.35),shadow:mixColor(f.face.skin,'#b16f6f',.25)},
    cloth:{base:f.outfit.color,light:mixColor(f.outfit.color,'#ffffff',.15),dark:mixColor(f.outfit.color,'#111122',.3)},accent:f.outfit.accent,ink:design.style.ink};
  const blueprint={format:'ai-live2d-character-blueprint',version:1,design_id:id,canvas:base.canvas,coordinates:base.coordinates,sides:base.sides,
    anatomy_reference:'maid-bust-front-v1',scope:{pose:'front',crop:'bust',costume:f.outfit.style,expression:'neutral',person_count:1},palette,style:design.style,groups,parts,
    rig_geometry:{head_pivot:pivot,neck_follow_y:follow,neck_fixed_y:fixed,head_x:eyeSpan*.05,head_y:eyeSpan*.026,head_tilt:.025},
    joins:{head_neck:rounded(point(head,[384,527])),neck_body:[384,614],eyes:groups.filter(g=>g.id.startsWith('group_eye')).map(g=>({id:g.id,anchor:g.anchor})),hair_roots:parts.filter(p=>p.parent==='group_hair').map(p=>({role:p.role,anchor:p.anchor}))},
    provider_policy:{batch:'one-design-all-33-parts',requires_transparent_rgba:true,requires_complete_hidden_layers:true,external_transmission_enabled:false}};
  return {design,blueprint,blueprint_id:await hashJSON(blueprint)};
}

export function createAIGenerationRequest(plan){
  return {format:'ai-live2d-ai-parts-request',version:1,design_id:plan.blueprint.design_id,blueprint_id:plan.blueprint_id,design:structuredClone(plan.design),blueprint:structuredClone(plan.blueprint),
    workflow:['Create one canonical character/style reference from the common design.','Condition every anatomical layer/group on that SAME reference and blueprint.','Generate full hidden surfaces, then individual transparent RGBA layers.','Return all 33 role IDs with dimensions, canvas positions, anchors, parents, occlusion and model/version/license provenance.','Reject missing layers and unsupported geometry; never substitute dummy art.'],
    status:'not-connected',request_sent:false,ai_generation_performed:false,expected_reference_images:[],
    approval_required:{destination:true,model_and_license:true,current_prices_and_budget:true,text_and_image_payload:true,data_retention:true}};
}

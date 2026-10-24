import {createTemplateManifest,partSvg} from './template.js';
import {mixColor} from '../../shared/character-design.js';
import {checkAbort,pngBlob} from './generator.js';
import {sameJSONData} from '../../shared/designed-character.js';

export const AI_PROVIDER_STATUS=Object.freeze({openai:{connected:false,external:true},gemini:{connected:false,external:true},'local-diffusion':{connected:false,external:false}});

function svgForDesign(p,plan){
  const base=createTemplateManifest().parts.find(b=>b.role===p.role),svg=partSvg(base,createTemplateManifest().generator.recipe),b=plan.blueprint,palette=b.palette;
  let inner=svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));
  const colors={'#dfd9ef':palette.hair.light,'#aca0c8':palette.hair.base,'#655778':palette.hair.dark,
    '#c6b7ff':palette.eyes.light,'#8065bd':palette.eyes.base,'#392852':palette.eyes.dark,'#403042':palette.ink,'#574453':palette.ink,
    '#fff0e5':palette.skin.light,'#ffe5db':palette.skin.base,'#efc3b7':palette.skin.shadow,
    '#f7d9d2':palette.skin.base,'#f9dcd5':palette.skin.light,'#b98f8e':mixColor(palette.skin.base,palette.ink,.4),
    '#ddb5ae':palette.skin.shadow,'#b58e91':mixColor(palette.skin.base,palette.ink,.4),'#c09a98':mixColor(palette.skin.base,palette.ink,.3),
    '#c19a99':mixColor(palette.skin.base,palette.ink,.3),'#c19a96':mixColor(palette.skin.base,palette.ink,.3),'#d2a29e':mixColor(palette.skin.base,palette.ink,.2),
    '#d49d98':mixColor(palette.skin.base,'#be7983',.3),'#eaa7ae':mixColor(palette.skin.base,'#e89eac',.55),'#f2b5b9':mixColor(palette.skin.base,'#e89eac',.2),'#fff5ed':mixColor(palette.skin.base,'#ffffff',.5),
    '#c69ba0':mixColor(palette.skin.base,palette.ink,.3),'#c998a3':mixColor(palette.skin.base,palette.ink,.25),
    '#474354':palette.cloth.light,'#282735':palette.cloth.base,'#191b29':palette.cloth.dark,'#666073':palette.cloth.light,'#655d73':palette.cloth.light,
    '#a46b7d':mixColor(palette.skin.base,palette.ink,.55),'#713d54':mixColor(palette.ink,'#7a3554',.5),'#d59baa':mixColor(palette.skin.base,'#be698c',.45)};
  if(p.role==='ribbon'){colors['#aca0c8']=palette.accent;colors['#dfd9ef']=mixColor(palette.accent,'#ffffff',.45);colors['#655778']=mixColor(palette.accent,palette.ink,.6);}
  inner=inner.replace(/#[0-9a-f]{6}/gi,c=>colors[c.toLowerCase()]??c).replace(/stroke-width="([\d.]+)"/g,(_,n)=>`stroke-width="${Number(n)*plan.design.style.line_width/2}"`);
  inner=inner.replace(/<(path|ellipse|circle|rect)\b/g,'<$1 vector-effect="non-scaling-stroke"');
  const q=p.rect,transform=p.generation.reference_transform;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${q.width}" height="${q.height}" viewBox="${q.x} ${q.y} ${q.width} ${q.height}"><g transform="matrix(${transform.join(' ')})">${inner}</g></svg>`;
}

export const localDesignProvider=Object.freeze({id:'local-design-v1',ai_generated:false,external:false,
  async generateCharacter(plan,{signal,onProgress=()=>{}}={}){
    const parts=new Map();
    for(const [index,p] of plan.blueprint.parts.entries()){
      checkAbort(signal);const c=document.createElement('canvas');c.width=p.rect.width;c.height=p.rect.height;
      const url=URL.createObjectURL(new Blob([svgForDesign(p,plan)],{type:'image/svg+xml'})),image=new Image();
      try{
        image.src=url;await image.decode();checkAbort(signal);const ctx=c.getContext('2d');if(!ctx)throw new Error('描画機能を利用できません。');ctx.drawImage(image,0,0);
        const blob=await pngBlob(c);checkAbort(signal);
        parts.set(p.role,{role:p.role,design_id:plan.blueprint.design_id,blueprint_id:plan.blueprint_id,rect:{...p.rect},anchor:[...p.anchor],parent:p.parent,order:p.order,complete_layer:true,blob});
        onProgress({completed:index+1,total:66,label:p.label,stage:'parts'});await new Promise(resolve=>setTimeout(resolve,0));
      }finally{image.src='';URL.revokeObjectURL(url);c.width=c.height=0;}
    }
    return {provider:{id:this.id,ai_generated:false,external:false},design_id:plan.blueprint.design_id,blueprint_id:plan.blueprint_id,parts};
  }});

export function resolveDesignProvider(id='local-design-v1'){
  if(id==='local-design-v1')return localDesignProvider;
  const error=new Error(id==='local-diffusion'?'ローカルAIのモデルと対応実行環境は未接続です。':'外部AIは未接続です。接続前に利用条件・費用・送信内容の確認と承認が必要です。');
  error.code='AI_PROVIDER_NOT_CONNECTED';throw error;
}

export function validateDesignBatch(plan,batch){
  if(batch?.provider?.id!=='local-design-v1'||batch.provider.ai_generated!==false||batch.provider.external!==false)throw new Error('生成元を確認できません。未接続のAIを成功扱いできません。');
  if(batch.design_id!==plan.blueprint.design_id||batch.blueprint_id!==plan.blueprint_id||!(batch.parts instanceof Map)||batch.parts.size!==33)throw new Error('共通デザインと33パーツの生成batchが一致しません。');
  for(const p of plan.blueprint.parts){
    const a=batch.parts.get(p.role);
    if(!a||a.role!==p.role||a.design_id!==batch.design_id||a.blueprint_id!==batch.blueprint_id||a.complete_layer!==true||
      ['rect','anchor','parent','order'].some(k=>!sameJSONData(a[k],p[k]))||!(a.blob instanceof Blob))throw new Error(`${p.role}: 他のデザインのパーツや配置を混ぜることはできません。`);
  }return batch;
}

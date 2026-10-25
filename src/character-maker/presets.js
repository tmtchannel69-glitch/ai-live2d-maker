import {createDesignPlan} from '../../shared/character-design.js';
import {HAIR_COLORS,EYE_COLORS} from '../character-generation/template.js';
import {designedPartSvg} from '../character-generation/design-provider.js';
import {pngBlob,checkAbort} from '../character-generation/generator.js';
import {PART_SETS} from '../../shared/modular-character.js';

// Original local artwork/transform presets for functional testing. No external
// character assets and no AI provenance or production-quality claim.
export async function createMakerPreset(project,set,{signal}={}){
  const m=project.current.manifest,plan=await createDesignPlan(m.version===2?m.design:{}),files=[];
  if(m.version===1){const h=HAIR_COLORS[m.generator.recipe.hair],e=EYE_COLORS[m.generator.recipe.eyes];plan.blueprint.palette.hair={light:h[0],base:h[1],dark:h[2]};plan.blueprint.palette.eyes={light:e[0],base:e[1],dark:e[2]};}
  if(!PART_SETS[set])throw new Error('対応していない交換セットです。');
  if(set==='outfit'){plan.blueprint.palette.cloth={light:'#496a8e',base:'#234368',dark:'#152a4b'};plan.blueprint.palette.accent='#eac1d2';}
  const parts=m.parts.filter(p=>PART_SETS[set].includes(p.role)&&!(set==='eyes'&&p.role.startsWith('brow_')));
  for(const p of parts){
    checkAbort(signal);const q=p.rect,c=Object.assign(document.createElement('canvas'),{width:q.width,height:q.height}),ctx=c.getContext('2d');
    if(!ctx)throw new Error('テンプレートを描画できません。');
    let bitmap,url,image;
    try{
      if(set==='eyes'){
        bitmap=await createImageBitmap(project.base.assets.get(p.role));checkAbort(signal);
        const anchor=m.groups.find(g=>g.id===p.parent).anchor;
        ctx.translate(anchor[0]-q.x,anchor[1]-q.y);ctx.scale(1,.84);ctx.translate(q.x-anchor[0],q.y-anchor[1]);ctx.drawImage(bitmap,0,0);
      }else{
        let svg;
        if(set==='bangs'){
          const palette=plan.blueprint.palette.hair,ink=plan.blueprint.palette.ink,t=p.generation?.reference_transform||[1,0,0,1,0,0];
          svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${q.width}" height="${q.height}" viewBox="${q.x} ${q.y} ${q.width} ${q.height}"><defs><linearGradient id="h" x2=".8" y2="1"><stop stop-color="${palette.light}"/><stop offset=".55" stop-color="${palette.base}"/><stop offset="1" stop-color="${palette.dark}"/></linearGradient></defs><g transform="matrix(${t.join(' ')})" stroke="${ink}" stroke-linejoin="round"><path d="M211 279 C204 174 274 100 384 101 C494 100 562 172 557 277 L537 319 C530 251 497 221 468 193 C445 248 398 290 356 313 C365 273 364 246 358 218 C329 265 282 288 234 319 Z" fill="url(#h)" stroke-width="2.3"/><path d="M233 237 C251 168 300 131 363 122 M397 121 C467 132 512 169 537 237" fill="none" stroke="${palette.light}" stroke-width="7"/><path d="M387 119 C413 170 412 237 369 292 M355 217 C325 203 292 230 252 290" fill="none" stroke="${palette.dark}" stroke-width="1.5"/></g></svg>`;
        }else svg=designedPartSvg({...p,generation:p.generation||{reference_transform:[1,0,0,1,0,0]}},plan);
        image=new Image();url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));image.src=url;await image.decode();checkAbort(signal);ctx.drawImage(image,0,0);
        if(p.role==='apron'){
          ctx.globalCompositeOperation='source-atop';ctx.fillStyle='#e7edf688';
          for(let x=15;x<q.width;x+=34)ctx.fillRect(x,0,5,q.height);
        }
      }
      const blob=await pngBlob(c);checkAbort(signal);files.push(new File([blob],p.role+'.png',{type:'image/png'}));
    }finally{bitmap?.close();if(image)image.src='';if(url)URL.revokeObjectURL(url);c.width=c.height=0;}
  }
  return files;
}

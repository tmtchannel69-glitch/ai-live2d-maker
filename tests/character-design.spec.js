import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import {decode} from 'fast-png';
import {validateDesignedCharacter} from '../shared/designed-character.js';
import {readCharacterContainer} from '../scripts/inochi2d/character-model.mjs';
test.use({hasTouch:true,isMobile:true});
const j=(f,n)=>JSON.parse(strFromU8(f[n]));
async function download(page,id){const e=page.waitForEvent('download');await page.locator('#'+id).click();const d=await e,b=[];for await(const c of await d.createReadStream())b.push(c);return Buffer.concat(b);}
async function generate(page){await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('INP/INX');}
async function open(page){await page.goto('/');await page.locator('#mode-generate').click();await page.locator('#cg-provider').selectOption('design-local');}

test('seven design features produce actual independent PNGs, model and design contract with honest local provenance',async({page})=>{
  await open(page);let sent=0;await page.route('**/api/**',r=>{sent++;return r.abort();});
  await page.locator('#cg-design-name').fill('Cafe Bob');await page.locator('#cg-design-hair-style').selectOption('bob');await page.locator('#cg-design-hair-color').fill('#b17654');
  await page.locator('#cg-design-eye-shape').selectOption('almond');await page.locator('#cg-design-eye-color').fill('#6096ba');await page.locator('#cg-design-outfit').selectOption('cafe-maid');await page.locator('#cg-design-mood').selectOption('bright');
  await generate(page);await expect(page.locator('#cg-summary')).toContainText('AI生成ではありません');await expect(page.locator('#cg-design-output')).toBeVisible();
  const files=unzipSync(await download(page,'cg-download-zip')),m=await validateDesignedCharacter(j(files,'character_manifest.json'));
  expect(Object.keys(files)).toHaveLength(49);expect(m.version).toBe(2);expect(m.generator.ai_generated).toBe(false);expect(m.design.features.hair.style).toBe('bob');
  for(const p of m.parts){const im=decode(files[p.file]);expect([im.width,im.height,im.channels,im.depth]).toEqual([p.rect.width,p.rect.height,4,8]);expect(im.data.some((v,i)=>i%4===3&&v>0)).toBe(true);}
  const parsed=readCharacterContainer(files['character.inp']);expect(parsed.model.meta.name).toBe('Cafe Bob');expect(parsed.model.param).toHaveLength(6);expect(parsed.textures).toHaveLength(33);
  expect(j(files,'inochi_report.json')).toMatchObject({profile:'designed-character-rig-v1',ai_generated:false,official_creator_tested:false,appearance_quality_passed:false});
  expect(j(files,'design_quality.json')).toMatchObject({placement_contract_passed:true,ai_visual_consistency_tested:false});
  const request=JSON.parse((await download(page,'cg-download-ai-request')).toString());expect(request).toMatchObject({request_sent:false,ai_generation_performed:false,status:'not-connected'});expect(request.blueprint.parts).toHaveLength(33);expect(sent).toBe(0);
  expect(await download(page,'cg-download-inp')).toEqual(Buffer.from(files['character.inp']));
});

test('downloaded design PNGs reconstruct the preview using an independent consumer of positions, order and clipping',async({page})=>{
  await open(page);await generate(page);const f=unzipSync(await download(page,'cg-download-zip')),m=j(f,'character_manifest.json');
  const images=Object.fromEntries(Object.entries(f).filter(([n])=>n.endsWith('.png')).map(([n,b])=>[n,Buffer.from(b).toString('base64')]));
  const differences=await page.evaluate(async({m,images})=>{
    const get=async n=>createImageBitmap(new Blob([Uint8Array.from(atob(images[n]),c=>c.charCodeAt(0))],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=768;c.height=1024;const x=c.getContext('2d');
    for(const p of [...m.parts].sort((a,b)=>a.order-b.order)){
      if(!p.enabled_in_neutral)continue;const b=await get(p.file);
      if(p.clip_to){const q=m.parts.find(q=>q.role===p.clip_to),mask=await get(q.file),s=document.createElement('canvas');s.width=p.rect.width;s.height=p.rect.height;const sc=s.getContext('2d');sc.drawImage(b,0,0);sc.globalCompositeOperation='destination-in';sc.drawImage(mask,q.rect.x-p.rect.x,q.rect.y-p.rect.y);x.drawImage(s,p.rect.x,p.rect.y);mask.close();s.width=s.height=0;}
      else x.drawImage(b,p.rect.x,p.rect.y);b.close();
    }
    const actual=x.getImageData(0,0,768,1024).data,expected=await get('preview.png');x.clearRect(0,0,768,1024);x.drawImage(expected,0,0);expected.close();const saved=x.getImageData(0,0,768,1024).data;
    let changed=0;for(let i=0;i<actual.length;i+=4)if(actual.slice(i,i+4).some((v,k)=>v!==saved[i+k]))changed++;return changed;
  },{m,images});expect(differences).toBe(0);
});

test('three local designs vary anatomy, retain all roles, and have independent eyes/mouth and fixed body',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {generateDesignedCharacter}=await import('/src/character-generation/design-generator.js');
    const settings=[{}, {features:{hair:{style:'bob',color:'#b17654'},eyes:{shape:'almond'},outfit:{style:'cafe-maid'},mood:'bright'}},{features:{face:{shape:'oval'},eyes:{shape:'slanted'},mood:'cool'}}],out=[];
    for(const s of settings){const r=await generateDesignedCharacter(s),nodes=[];const visit=n=>{nodes.push(n);for(const c of n.children)visit(c);};visit(r.native.model.nodes);const byId=new Map(nodes.map(n=>[n.uuid,n]));
      out.push({parts:r.assets.size,id:r.manifest.generator.design_id,eyes:r.manifest.parts.find(p=>p.role==='eye_white_l').rect,hair:r.manifest.parts.find(p=>p.role==='side_hair_l').rect,geometry:r.manifest.rig_geometry,
        targets:r.native.model.param.map(p=>({name:p.name,targets:p.bindings.map(b=>byId.get(b.node).name)}))});}
    return out;
  });expect(new Set(result.map(r=>r.id)).size).toBe(3);for(const r of result){expect(r.parts).toBe(33);for(const p of r.targets){if(p.name.startsWith('Head'))expect(p.targets).toEqual(['group_head','neck']);if(p.name==='MouthOpen')expect(p.targets.every(n=>n.startsWith('mouth_'))).toBe(true);}}
  expect(result[0].hair.height).toBeGreaterThan(result[1].hair.height);expect(result[0].eyes.height).toBeGreaterThan(result[1].eyes.height);expect(result[0].geometry.neck_follow_y).not.toBe(result[2].geometry.neck_follow_y);
});

test('invalid design and modeling cancellation preserve previous character; retry succeeds without fallback',async({page})=>{
  await open(page);await generate(page);const before=await download(page,'cg-download-inp');
  await page.locator('#cg-design-name').fill('');await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('生成できません');expect(await download(page,'cg-download-inp')).toEqual(before);
  await page.locator('#cg-design-name').fill('Retry');await page.evaluate(()=>{const e=document.querySelector('#cg-status'),o=new MutationObserver(()=>{if(e.textContent.includes('Inochi2Dモデルを作成中')){o.disconnect();document.querySelector('#cg-cancel').click();}});o.observe(e,{childList:true,subtree:true});});
  await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('生成を中止');expect(await download(page,'cg-download-inp')).toEqual(before);
  await generate(page);expect((await download(page,'cg-download-inp')).equals(before)).toBe(false);
});

test('AI providers remain disconnected, never fall back to template, and phone design controls fit',async({page})=>{
  await open(page);await expect(page.locator('#cg-provider option[value=ai]')).toHaveJSProperty('disabled',true);
  expect(await page.evaluate(async()=>{const {generateDesignedCharacter}=await import('/src/character-generation/design-generator.js');try{await generateDesignedCharacter({}, {providerId:'openai'});return 'unexpected success';}catch(e){return e.code;}})).toBe('AI_PROVIDER_NOT_CONNECTED');
  for(const size of [{width:320,height:640},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const id of ['cg-design-name','cg-design-hair-style','cg-design-hair-color','cg-design-eye-shape','cg-design-outfit','cg-design-mood']){
      const d=await page.locator('#'+id).evaluate(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)}));expect(d.height).toBeGreaterThanOrEqual(48);expect(d.font).toBeGreaterThanOrEqual(16);
    }
  }
});

test('opaque background tiles are refused by both the asset gate and native adapter',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {generateDesignedCharacter}=await import('/src/character-generation/design-generator.js'),{validateAsset}=await import('/src/character-generation/generator.js'),{buildDesignedInochi}=await import('/shared/generated-character-inochi.js');
    const character=await generateDesignedCharacter(),p=character.manifest.parts.find(p=>p.role==='face_base'),c=document.createElement('canvas');c.width=p.rect.width;c.height=p.rect.height;c.getContext('2d').fillRect(0,0,c.width,c.height);const opaque=await new Promise(r=>c.toBlob(r));
    const errors=[];try{await validateAsset(p,opaque,null,{requireTransparency:true});}catch(e){errors.push(e.message);}
    const bytes=new Map();for(const [id,b] of character.assets)bytes.set(id,new Uint8Array(await (id===p.role?opaque:b).arrayBuffer()));
    try{await buildDesignedInochi(character.manifest,bytes);}catch(e){errors.push(e.message);}
    return errors;
  });expect(result).toHaveLength(2);expect(result.every(e=>e.includes('透明')||e.includes('透過'))).toBe(true);
});

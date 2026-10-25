import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import {decode} from 'fast-png';
import {validateCharacterManifest,GENERATED_ROLES} from '../shared/generated-character.js';

test.use({hasTouch:true,isMobile:true});
async function generate(page,settings={}){
  await page.locator('#mode-generate').click();for(const [key,value] of Object.entries(settings))await page.locator('#cg-'+key).selectOption(value);
  await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('33パーツを組み立てました');
}
async function download(page,selector){
  const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending,chunks=[];for await(const chunk of await d.createReadStream())chunks.push(chunk);
  return {bytes:Buffer.concat(chunks),name:d.suggestedFilename()};
}
const json=(files,name)=>JSON.parse(strFromU8(files[name]));

test('assembles 33 genuine independent PNGs, exports data, and reconstructs the preview from the downloaded contract',async({page})=>{
  await page.goto('/?mode=convert');let requests=0;await page.route('**/api/**',r=>{requests++;return r.abort();});
  await generate(page);await expect(page.locator('#image-conversion-mode')).toBeHidden();await expect(page.locator('#cg-part option')).toHaveCount(33);
  const zip=await download(page,'#cg-download-zip');expect(zip.name).toBe('ai-live2d-generated-character.zip');const files=unzipSync(zip.bytes),m=validateCharacterManifest(json(files,'character_manifest.json'));
  expect(Object.keys(files)).toHaveLength(45);expect(m.generator).toMatchObject({id:'template',ai_generated:false});
  const stats={};for(const role of GENERATED_ROLES){const p=m.parts.find(p=>p.role===role),im=decode(files[p.file]);
    expect([im.width,im.height,im.channels,im.depth]).toEqual([p.rect.width,p.rect.height,4,8]);
    let visible=0,transparent=0;for(let i=3;i<im.data.length;i+=4){if(im.data[i])visible++;else transparent++;}
    expect(visible,role).toBeGreaterThan(0);expect(transparent,role).toBeGreaterThan(0);stats[role]={visible,transparent};
  }
  const face=m.parts.find(p=>p.role==='face_base'),im=decode(files[face.file]),eye=(349-face.rect.y)*im.width+306-face.rect.x;
  expect(im.data[eye*4]).toBeGreaterThan(im.data[eye*4+2]); // Skin bed exists behind the separately generated eye.
  expect(m.parts.find(p=>p.role==='mouth_inside').enabled_in_neutral).toBe(false);
  for(const side of ['l','r'])expect(m.parts.find(p=>p.role==='iris_'+side).clip_to).toBe('eye_white_'+side);
  expect(json(files,'rig_metadata.json')).toMatchObject({rest_pose_only:true,motion_keys:[],runtime_verified:false});
  const bridge=json(files,'inochi_intermediate.json');expect(bridge.native_model).toBe(false);expect(bridge.nodes.filter(n=>n.type==='Part')).toHaveLength(33);
  const assets=Object.fromEntries(Object.entries(files).filter(([n])=>n.endsWith('.png')).map(([n,b])=>[n,Buffer.from(b).toString('base64')]));
  const check=await page.evaluate(async({m,assets})=>{
    // Independent consumer of the saved ZIP, without the application assembler.
    const load=async name=>createImageBitmap(new Blob([Uint8Array.from(atob(assets[name]),c=>c.charCodeAt(0))],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=m.canvas.width;c.height=m.canvas.height;const ctx=c.getContext('2d');
    for(const p of [...m.parts].sort((a,b)=>a.order-b.order)){
      if(!p.enabled_in_neutral)continue;const bitmap=await load(p.file);
      if(p.clip_to){const target=m.parts.find(t=>t.role===p.clip_to),mask=await load(target.file),s=document.createElement('canvas');s.width=p.rect.width;s.height=p.rect.height;const sc=s.getContext('2d');sc.drawImage(bitmap,0,0);sc.globalCompositeOperation='destination-in';sc.drawImage(mask,target.rect.x-p.rect.x,target.rect.y-p.rect.y);ctx.drawImage(s,p.rect.x,p.rect.y);mask.close();s.width=s.height=0;}
      else ctx.drawImage(bitmap,p.rect.x,p.rect.y);bitmap.close();
    }
    const rendered=ctx.getImageData(0,0,c.width,c.height).data,expected=await load('preview.png');ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(expected,0,0);expected.close();const saved=ctx.getImageData(0,0,c.width,c.height).data;let changed=0;
    for(let i=0;i<rendered.length;i+=4)if(rendered[i]!==saved[i]||rendered[i+1]!==saved[i+1]||rendered[i+2]!==saved[i+2]||rendered[i+3]!==saved[i+3])changed++;
    return {changed,cornerAlpha:saved[3]};
  },{m,assets});
  expect(check).toEqual({changed:0,cornerAlpha:0});expect(requests).toBe(0);
  expect((await download(page,'#cg-download-preview')).bytes).toEqual(Buffer.from(files['preview.png']));
  await page.locator('#cg-part').selectOption('ear_l');expect((await download(page,'#cg-part-download')).bytes).toEqual(Buffer.from(files['parts/ear_l.png']));
});

test('switching modes preserves the original source, parts and work ZIP without sending them to the new generator',async({page})=>{
  await page.goto('/?mode=convert');await page.locator('#try-sample').click();await expect(page.locator('#save-project')).toBeEnabled();
  const source=await page.locator('#source-preview').getAttribute('src'),before=await download(page,'#save-project');
  let requests=0;await page.route('**/api/**',r=>{requests++;return r.abort();});await generate(page);
  await page.locator('#mode-convert').click();await expect(page.locator('#source-preview')).toBeVisible();expect(await page.locator('#source-preview').getAttribute('src')).toBe(source);
  // The old ZIP writer stamps entries at download time. Compare the saved
  // payloads, rather than requiring equal ZIP header timestamps.
  expect(unzipSync((await download(page,'#save-project')).bytes)).toEqual(unzipSync(before.bytes));await page.locator('#mode-generate').click();await expect(page.locator('#cg-preview-image')).toBeVisible();expect(requests).toBe(0);
});

test('background affects the composite only and saved settings match the completed generation',async({page})=>{
  await page.goto('/?mode=convert');await generate(page);const before=(await download(page,'#cg-download-zip')).bytes,original=unzipSync(before);
  await page.locator('#cg-background').selectOption('white');await expect(page.locator('#cg-saved-settings')).toContainText('前回');
  expect((await download(page,'#cg-download-zip')).bytes).toEqual(before);
  await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('33パーツを組み立てました');
  const next=unzipSync((await download(page,'#cg-download-zip')).bytes);for(const p of json(next,'character_manifest.json').parts)expect(next[p.file]).toEqual(original[p.file]);
  const preview=decode(next['preview.png']);expect(Array.from(preview.data.slice(0,4))).toEqual([255,255,255,255]);
  const recipe=JSON.parse((await download(page,'#cg-download-recipe')).bytes.toString());expect(recipe.background).toBe('white');
});

test('cancel and failed generation keep the previous character and unlock retry',async({page})=>{
  await page.goto('/?mode=convert');await generate(page);const before=await download(page,'#cg-download-zip');
  await page.evaluate(()=>{window.realCgBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(...args){setTimeout(()=>window.realCgBlob.apply(this,args),200);};});
  await page.locator('#cg-generate').click();await page.locator('#cg-cancel').click();await expect(page.locator('#cg-status')).toContainText('生成を中止');await expect(page.locator('#cg-status')).toContainText('保持');
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=function(callback){setTimeout(()=>callback(null),0);};});
  await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('生成できません');expect((await download(page,'#cg-download-zip')).bytes).toEqual(before.bytes);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.realCgBlob;});await page.locator('#cg-eyes').selectOption('blue');await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('33パーツを組み立てました');
  const next=unzipSync((await download(page,'#cg-download-zip')).bytes);expect(json(next,'generation_recipe.json').eyes).toBe('blue');
});

test('missing, blank, wrong-size and unlabelled external providers fail instead of substituting dummy assets',async({page})=>{
  await page.goto('/?mode=convert');const result=await page.evaluate(async()=>{
    const {generateCharacter,localPartProvider}=await import('/src/character-generation/generator.js');
    const c=document.createElement('canvas');c.width=c.height=2;const tiny=await new Promise(r=>c.toBlob(r));const failures=[];
    for(const which of ['null','tiny','blank','external']){
      const provider={...localPartProvider,generate:async part=>{if(which==='null')return null;if(which==='tiny')return tiny;c.width=part.rect.width;c.height=part.rect.height;return new Promise(r=>c.toBlob(r));},...(which==='external'?{id:'external-ai',aiGenerated:true}:{})};
      try{await generateCharacter({}, {provider});failures.push(false);}catch(e){failures.push(e.message);}
    }return failures;
  });expect(result.every(s=>typeof s==='string'&&s.length>0)).toBe(true);
});

test('dummy mode is labelled and exposes the same 33-part output contract',async({page})=>{
  await page.goto('/?mode=convert');await generate(page,{provider:'dummy'});await expect(page.locator('#cg-summary')).toContainText('配置確認用');
  const files=unzipSync((await download(page,'#cg-download-zip')).bytes);expect(validateCharacterManifest(json(files,'character_manifest.json')).generator.id).toBe('dummy');
  expect(Object.keys(files)).toHaveLength(39);expect(files['character.inp']).toBeUndefined();await expect(page.locator('#cg-model-output')).toBeHidden();
});

test('phone and landscape controls fit, are touch-sized, and retain the preview across mode changes',async({page})=>{
  await page.goto('/?mode=convert');await generate(page);
  for(const size of [{width:320,height:640},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
    await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const id of ['mode-convert','mode-generate','cg-generate','cg-hair','cg-eyes','cg-background','cg-part','cg-download-zip','cg-download-inp','cg-download-inx']){
      const measured=await page.locator('#'+id).evaluate(e=>({h:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)}));
      expect(measured.h,id).toBeGreaterThanOrEqual(48);expect(measured.font,id).toBeGreaterThanOrEqual(16);
    }
  }
  const image=await page.locator('#cg-preview-image').getAttribute('src');await page.locator('#mode-convert').click();await page.locator('#mode-generate').click();expect(await page.locator('#cg-preview-image').getAttribute('src')).toBe(image);
});

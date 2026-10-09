import {test,expect} from '@playwright/test';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import catalog from '../shared/parts.json' with {type:'json'};
const production=catalog.production.map(part=>part.id);
async function setup(page){await page.goto('/');const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=256;c.height=384;c.getContext('2d').fillStyle='purple';c.getContext('2d').fillRect(0,0,256,384);return c.toDataURL().split(',')[1];});await page.locator('#file').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.locator('#source-preview')).toBeVisible();return png;}
async function point(page,id,x='50',y='50'){await page.locator('#prompt-part').selectOption(id);await page.locator('#coordinate-form input[name=x]').fill(x);await page.locator('#coordinate-form input[name=y]').fill(y);await page.getByRole('button',{name:'数値を反映'}).click();}
async function prompts(page,ids){for(const id of ids)await page.locator(`.part-options input[value=${id}]`).check();await page.locator('#edit-prompts').click();await page.getByText('数値で指定（キーボード操作）').click();for(const id of ids)await point(page,id,id==='eye_l'?'75':'50',id==='hair_front'?'10':'50');await page.locator('#close-prompts').click();}
function requestPrompts(route){return JSON.parse(route.request().postData().match(/name="prompts"\r\n\r\n([^\r]+)/)[1]);}
async function downloaded(page,selector){const pending=page.waitForEvent('download');await page.locator(selector).click();const chunks=[];for await(const c of await(await pending).createReadStream())chunks.push(c);return Buffer.concat(chunks);}
async function openProject(page,bytes){await page.locator('#project-file').setInputFiles({name:'work.zip',mimeType:'application/zip',buffer:bytes});}

test('production and basic results survive switching, correction and versioned project restore',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const png=await setup(page);
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);
  const basicUrl=await page.locator('[data-part=hair] img').getAttribute('src'),basicPng=await downloaded(page,'[data-part=hair] a');
  const v1=await downloaded(page,'#save-project');expect(JSON.parse(strFromU8(unzipSync(v1)['project.json'])).version).toBe(1);
  await page.locator('#parts-template').selectOption('production');await expect(page.locator('#processing-mode')).toHaveValue('ai');await expect(page.locator('.part-options input')).toHaveCount(15);await expect(page.locator('#template-help')).toContainText('左＝画面右');await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.locator('#processing-mode option[value=demo]')).toHaveJSProperty('disabled',true);await prompts(page,['hair_front','eye_l']);
  let calls=0;await page.route('**/api/separate',route=>{calls++;const data=requestPrompts(route);expect(data.every(p=>production.includes(p.id))).toBe(true);expect(data.find(p=>p.id==='eye_l')?.points[0].x).toBe(0.75);return route.fulfill({contentType:'application/json',body:JSON.stringify({parts:data.map(p=>({id:p.id,png}))})});});
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(2);
  await page.getByRole('button',{name:'目・左（画面右）をブラシで補正',exact:true}).click();await expect(page.locator('#brush-status')).toContainText('なぞって');await page.getByText('数値でブラシを置く（キーボード操作）').click();await page.getByRole('button',{name:'ブラシを置く',exact:true}).click();await page.locator('#brush-apply').click();await expect(page.locator('#brush-dialog')).not.toBeVisible();
  const corrected=await downloaded(page,'[data-part=eye_l] a');const v2=await downloaded(page,'#save-project'),metadata=JSON.parse(strFromU8(unzipSync(v2)['project.json']));expect(metadata.version).toBe(2);expect(metadata.parts).toHaveLength(6);
  const zip=unzipSync(await downloaded(page,'#download-all'));expect(Object.keys(zip).sort()).toEqual(['eye_l.png','hair_front.png']);
  await page.locator('#parts-template').selectOption('basic');expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(basicUrl);await expect(page.locator('#processing-mode')).toHaveValue('demo');await expect(page.locator('.result-card')).toHaveCount(4);
  await page.reload();await openProject(page,v2);await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#parts-template')).toHaveValue('production');await expect(page.locator('[data-part=eye_l] .result-state')).toContainText('ブラシ補正済み');expect(await downloaded(page,'[data-part=eye_l] a')).toEqual(corrected);
  await page.getByRole('button',{name:'目・左（画面右）を修正',exact:true}).click();await expect(page.locator('#prompt-part')).toHaveValue('eye_l');await page.locator('#separate-one').click();await expect(page.locator('#prompt-run-status')).toContainText('だけを更新');await page.locator('#close-prompts').click();expect(calls).toBe(2);
  await page.locator('#parts-template').selectOption('basic');expect(await downloaded(page,'[data-part=hair] a')).toEqual(basicPng);
  await openProject(page,v1);await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#parts-template')).toHaveValue('basic');await expect(page.locator('.result-card')).toHaveCount(4);
  await page.locator('#parts-template').selectOption('production');await expect(page.locator('.result-card')).toHaveCount(0);await expect(page.locator('.part-options input:checked')).toHaveCount(0);expect(errors).toEqual([]);
});

test('15 parts are processed in four-item batches; late failure and cancellation keep atomic results',async({page})=>{
  test.setTimeout(60000);const png=await setup(page);await page.locator('#parts-template').selectOption('production');await prompts(page,production);
  let phase='success',batch=0,counts=[],release,entered;let gate=Promise.resolve();
  await page.route('**/api/separate',async route=>{
    const data=requestPrompts(route);batch++;counts.push(data.length);
    if(phase==='failure' && batch===2)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'second batch failed'})});
    if(phase==='cancel' && batch===2){entered();await gate;}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({parts:data.map(p=>({id:p.id,png}))})});
  });
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(15);expect(counts).toEqual([4,4,4,3]);
  const before=await page.locator('.result-card img').evaluateAll(imgs=>imgs.map(img=>img.src));
  phase='failure';batch=0;counts=[];await page.locator('#separate').click();await expect(page.locator('#status')).toContainText('second batch failed');expect(counts).toEqual([4,4]);expect(await page.locator('.result-card img').evaluateAll(imgs=>imgs.map(img=>img.src))).toEqual(before);
  phase='success';batch=0;counts=[];await page.locator('#separate').click();await expect(page.locator('#status')).toContainText('15 個のAI');expect(counts).toEqual([4,4,4,3]);
  phase='cancel';batch=0;counts=[];gate=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{entered=resolve;});await page.locator('#separate').click();await started;await page.locator('#reset').click();release();await page.waitForTimeout(300);expect(counts).toEqual([4,4]);await expect(page.locator('.result-card')).toHaveCount(0);await expect(page.locator('#status')).toContainText('まずは');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('version 2 rejects inconsistent templates and keeps both template workspaces',async({page})=>{
  await setup(page);await page.locator('#parts-template').selectOption('production');await prompts(page,['eye_r']);const project=await downloaded(page,'#save-project');
  const cases=[m=>{m.template='unknown';},m=>{m.templates.production.mode='demo';m.mode='demo';},m=>{m.templates.production.selected=['hair'];m.selected=['hair'];},m=>{m.templates.basic=null;},m=>{m.version=1;},m=>{m.prompts.unknown={};}];
  for(const change of cases){const entries=unzipSync(project),m=JSON.parse(strFromU8(entries['project.json']));change(m);entries['project.json']=strToU8(JSON.stringify(m));await openProject(page,Buffer.from(zipSync(entries,{level:0})));await expect(page.locator('#project-status')).toContainText('読み込みに失敗');await expect(page.locator('#parts-template')).toHaveValue('production');await expect(page.locator('input[value=eye_r]')).toBeChecked();}
  await page.locator('#edit-prompts').click();await page.locator('#prompt-part').selectOption('eye_r');await expect(page.locator('#prompt-dialog svg circle')).toHaveCount(1);await page.locator('#close-prompts').click();
  await page.setViewportSize({width:1440,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

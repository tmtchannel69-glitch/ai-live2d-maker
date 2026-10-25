import {test,expect} from '@playwright/test';
import {unzipSync,zipSync,strToU8} from 'fflate';

test.use({hasTouch:true,isMobile:true});
const output=Buffer.from(zipSync({
  'model.inp':strToU8('TRNSRTS\0transport fixture, not a runtime model'),
  'model.inx':strToU8('TRNSRTS\0transport fixture, not a runtime model'),
  'generation-report.json':strToU8(JSON.stringify({format:'ai-live2d-maker-inochi2d-image-pipeline',version:1,transportFixture:true,officialCreatorTested:false})),
},{level:0}));
async function ready(page,status={configured:true,busy:false,creatorVersion:'0.8.6',experimental:true}){
  await page.route('**/api/inochi2d/status',route=>route.fulfill({json:status}));
}
async function image(page,name='character.png'){
  const base64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#b89aff';ctx.fillRect(20,5,80,170);return c.toDataURL().split(',')[1];});
  const buffer=Buffer.from(base64,'base64');
  await page.locator('#file').setInputFiles({name,mimeType:'image/png',buffer});
  await expect(page.locator('#file-info')).toContainText(name);
  return buffer;
}
async function saveWork(page){
  const pending=page.waitForEvent('download');await page.locator('#save-project').click();
  const download=await pending,chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  return unzipSync(Buffer.concat(chunks));
}
async function saveModel(page){
  const pending=page.waitForEvent('download');await page.locator('#inochi-model-download').click();
  const download=await pending,chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  expect(download.suggestedFilename()).toBe('inochi2d-character.zip');
  return Buffer.concat(chunks);
}

test('explicit generation requires no prompts, uploads raw source only, and preserves existing work',async({page})=>{
  await page.goto('/?mode=convert');let sends=0,checks=0;
  await page.route('**/api/inochi2d/status',route=>{checks++;return route.fulfill({json:{configured:true,busy:false}});});
  let source;
  await page.route('**/api/inochi2d/generate',route=>{
    sends++;expect(route.request().headers()['content-type']).toBe('image/png');
    expect(route.request().postDataBuffer()).toEqual(source);
    return route.fulfill({contentType:'application/zip',body:output});
  });
  source=await image(page);expect(sends).toBe(0);expect(checks).toBe(0);
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);
  await page.locator('#processing-mode').selectOption('ai');
  await expect(page.locator('#separate')).toBeDisabled();
  const before=await saveWork(page);
  await expect(page.locator('#inochi-model-start')).toBeEnabled();
  await page.locator('#inochi-model-start').click();
  await expect(page.locator('#inochi-model-status')).toContainText('モデルを生成しました');
  expect(sends).toBe(1);expect(checks).toBe(1);
  expect(await saveModel(page)).toEqual(output);
  expect(await saveWork(page)).toEqual(before);
  await expect(page.locator('.inochi-model-panel')).toContainText('Live2D Cubism・VTube Studio用のモデルとは異なります');
  await expect(page.locator('#inochi-model-status')).toContainText('確認済みとは判定していません');
});

test('unconfigured or busy server never receives the image; phone controls fit and stay readable',async({page})=>{
  await page.goto('/?mode=convert');await image(page);let sends=0;
  await page.route('**/api/inochi2d/generate',route=>{sends++;return route.fulfill({status:503,json:{error:'not configured'}});});
  await ready(page,{configured:false,busy:false});await page.locator('#inochi-model-start').click();
  await expect(page.locator('#inochi-model-status')).toContainText('未設定');
  await page.unroute('**/api/inochi2d/status');await ready(page,{configured:true,busy:true});
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('処理中');
  expect(sends).toBe(0);await expect(page.locator('#save-project')).toBeEnabled();
  for(const viewport of [{width:320,height:640},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.locator('#inochi-model-start').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator('#inochi-model-start').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    expect(await page.locator('#inochi-model-start').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.locator('#inochi-model-status').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  }
});

test('failed retry retains the previous model and original project; malformed responses are rejected',async({page})=>{
  await page.goto('/?mode=convert');await page.locator('#try-sample').click();await expect(page.locator('#scene-inspect')).toBeEnabled();
  await ready(page);const before=await saveWork(page);
  await page.route('**/api/inochi2d/generate',route=>route.fulfill({contentType:'application/zip',body:output}));
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-download')).toBeVisible();
  for(const response of [{status:422,json:{error:'自動検出に失敗しました。'}},{contentType:'application/zip',body:Buffer.from('not a zip')},{contentType:'text/html',body:'<html>wrong server</html>'}]){
    await page.unroute('**/api/inochi2d/generate');await page.route('**/api/inochi2d/generate',route=>route.fulfill(response));
    await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('前回生成したモデル');
    expect(await saveModel(page)).toEqual(output);expect(await saveWork(page)).toEqual(before);
  }
});

test('cancel, reset, and replacing the source reject delayed responses and release all locks',async({page})=>{
  await page.goto('/?mode=convert');await image(page);await ready(page);
  const releases=[];
  await page.route('**/api/inochi2d/generate',async route=>{
    await new Promise(resolve=>releases.push(resolve));
    await route.fulfill({contentType:'application/zip',body:output}).catch(()=>{});
  });
  const downloads=[];page.on('download',download=>downloads.push(download));
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('自動生成しています');
  await expect(page.locator('#save-project')).toBeDisabled();await expect(page.locator('#inochi-model-progress')).toBeVisible();
  await expect.poll(()=>releases.length).toBe(1);
  await page.locator('#inochi-model-cancel').click();await expect(page.locator('#inochi-model-status')).toContainText('中止');
  await expect(page.locator('#save-project')).toBeEnabled();releases[0]();
  await page.locator('#inochi-model-start').click();await expect.poll(()=>releases.length).toBe(2);
  await image(page,'replacement.png');releases[1]();
  await expect(page.locator('#inochi-model-start')).toBeEnabled();await expect(page.locator('#inochi-model-result')).toBeHidden();
  await page.locator('#inochi-model-start').click();await expect.poll(()=>releases.length).toBe(3);
  await page.locator('#reset').click();releases[2]();
  await expect(page.locator('#open-project')).toBeEnabled();await expect(page.locator('#inochi-model-start')).toBeDisabled();
  await expect(page.locator('#inochi-model-result')).toBeHidden();await expect(page.locator('#inochi-model-progress')).toBeHidden();
  expect(downloads).toHaveLength(0);
});

test('reset during readiness check cannot upload the old image',async({page})=>{
  await page.goto('/?mode=convert');await image(page);let release,sends=0;
  const held=new Promise(resolve=>release=resolve);
  await page.route('**/api/inochi2d/status',async route=>{await held;await route.fulfill({json:{configured:true,busy:false}}).catch(()=>{});});
  await page.route('**/api/inochi2d/generate',route=>{sends++;return route.fulfill({contentType:'application/zip',body:output});});
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('準備を確認');
  await page.locator('#reset').click();release();
  await expect(page.locator('#inochi-model-start')).toBeDisabled();await expect(page.locator('#open-project')).toBeEnabled();
  expect(sends).toBe(0);
});

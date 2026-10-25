import {test,expect} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';
test.use({hasTouch:true,isMobile:true});
const fixture=Buffer.from(zipSync({'model.inp':strToU8('transport fixture, not a runtime model'),'generation-report.json':strToU8('{"officialCreatorTested":false}')},{level:0}));
const statusPattern=/\/api\/inochi2d\/status(?:\?.*)?$/;
const generatePattern=/\/api\/inochi2d\/generate(?:\?.*)?$/;
async function selectImage(page){
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=180;c.getContext('2d').fillRect(20,10,80,160);return c.toDataURL().split(',')[1];});
  await page.locator('#file').setInputFiles({name:'local-character.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
}
const configured={mode:'detailed-head',configured:true,busy:false};

test('readiness works without a source and missing SAM never causes an image POST',async({page})=>{
  await page.goto('/');let checks=0,sends=0;
  await page.route(statusPattern,route=>{checks++;expect(route.request().method()).toBe('GET');expect(route.request().postData()).toBe(null);return route.fulfill({json:{...configured,configured:false,reason:'SAM2.1の重みが未配置です。自動取得は行いません。'}});});
  await page.route(generatePattern,route=>{sends++;return route.abort();});
  await page.locator('#inochi-model-mode').selectOption('detailed-head');
  await page.locator('#inochi-model-check').click();await expect(page.locator('#inochi-model-status')).toContainText('SAM2.1');
  expect(checks).toBe(1);expect(sends).toBe(0);await selectImage(page);expect(sends).toBe(0);
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('画像は送信していません');expect(sends).toBe(0);
});

test('an old server cannot silently process the detailed request as five parts',async({page})=>{
  await page.goto('/');await selectImage(page);let sends=0;
  await page.route(statusPattern,route=>route.fulfill({json:{configured:true,busy:false}}));
  await page.route(generatePattern,route=>{sends++;return route.abort();});
  await page.locator('#inochi-model-mode').selectOption('detailed-head');await page.locator('#inochi-model-start').click();
  await expect(page.locator('#inochi-model-status')).toContainText('詳細モードに対応していません');expect(sends).toBe(0);
});

test('mode-tagged model download and previous result survive failed retries and cancellation',async({page})=>{
  await page.goto('/');await selectImage(page);await page.locator('#inochi-model-mode').selectOption('detailed-head');
  await page.route(statusPattern,route=>route.fulfill({json:configured}));
  await page.route(generatePattern,route=>{expect(new URL(route.request().url()).searchParams.get('mode')).toBe('detailed-head');return route.fulfill({contentType:'application/zip',body:fixture});});
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('胴体は固定');
  await expect(page.locator('#inochi-model-result-kind')).toContainText('頭・首・胴体');
  const download=page.waitForEvent('download');await page.locator('#inochi-model-download').click();expect((await download).suggestedFilename()).toBe('inochi2d-head-neck-body.zip');
  await page.unroute(generatePattern);await page.route(generatePattern,route=>route.fulfill({status:422,json:{error:'顎の境界を検出できません。'}}));
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('前回生成したモデル');await expect(page.locator('#inochi-model-download')).toBeEnabled();
  await page.unroute(generatePattern);let release;const held=new Promise(r=>{release=r;});
  await page.route(generatePattern,async route=>{await held;await route.fulfill({contentType:'application/zip',body:fixture}).catch(()=>{});});
  await page.locator('#inochi-model-start').click();await expect(page.locator('#inochi-model-status')).toContainText('自動生成しています');
  await expect(page.locator('#inochi-model-mode')).toBeDisabled();await page.locator('#inochi-model-cancel').click();release();
  await expect(page.locator('#inochi-model-status')).toContainText('中止');await expect(page.locator('#inochi-model-download')).toBeEnabled();
  await expect(page.locator('#file-info')).toContainText('local-character.png');await expect(page.locator('#save-project')).toBeEnabled();
});

test('phone controls stay usable at 320 and 390 widths',async({page})=>{
  await page.goto('/');await page.locator('#inochi-model-mode').selectOption('detailed-head');
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const id of ['#inochi-model-mode','#inochi-model-check','#inochi-model-start']){
      expect(await page.locator(id).evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
      expect(await page.locator(id).evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
  }
});

import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encode} from 'fast-png';
import {zipSync,strToU8} from 'fflate';
import {createPreviewPage} from '../scripts/model-build/create-preview-page.mjs';

test.use({hasTouch:true,isMobile:true});

// Original tiny images exercise the packaged page; no character/model is used.
const poses=['default','both-closed','both-025','both-05','both-075','both-10','both-15','both-25','both-half','both-75'];
let directory,html;
const work=Buffer.from(zipSync({'work-fixture.txt':strToU8('work, including original-image placeholder')},{level:0}));
const model=Buffer.from(zipSync({'model-fixture.txt':strToU8('transport fixture, not a model')},{level:0}));
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'live2d-preview-page-'));
  const writes=[];
  for(const [i,pose] of poses.entries()){
    const png=encode({width:2,height:2,channels:4,depth:8,data:new Uint8Array(Array(4).fill([20+i*20,80,140,255]).flat())});
    for(const area of ['face','full'])writes.push(writeFile(join(directory,`${area}-${pose}.png`),png));
  }
  writes.push(writeFile(join(directory,'preview-report.json'),JSON.stringify({format:'ai-live2d-independent-cpu-preview',version:1,model_sha256:'0'.repeat(64),pose_set:'blink-transitions',poses:Object.fromEntries(poses.map(p=>[p,{}]))})));
  writes.push(writeFile(join(directory,'work.zip'),work),writeFile(join(directory,'model.zip'),model));
  await Promise.all(writes);
  const output=join(directory,'review.html');
  await createPreviewPage({renders:directory,output,work:join(directory,'work.zip'),model:join(directory,'model.zip')});
  html=await readFile(output,'utf8');
});
test.afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});

async function open(page){
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>requests.push(r.url()));
  await page.route('**/private-preview-fixture',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  await page.goto('/private-preview-fixture');
  await expect(page.locator('#preview')).toHaveJSProperty('complete',true);
  return {errors,requests};
}

test('phone review can step through small blink openings and manual actions stop playback',async({page})=>{
  const {errors,requests}=await open(page);
  await expect(page.locator('#pose option')).toHaveCount(10);
  await expect(page.locator('#pose')).toHaveValue('default');
  await page.locator('#next').click();
  await expect(page.locator('#pose')).toHaveValue('both-closed');
  await page.locator('#next').click();
  await expect(page.locator('#pose')).toHaveValue('both-025');
  await page.locator('#previous').click();
  await expect(page.locator('#pose')).toHaveValue('both-closed');
  await page.locator('#previous').click();
  await expect(page.locator('#pose')).toHaveValue('default');
  await page.locator('#pose').selectOption('both-025');
  await expect(page.locator('#caption')).toContainText('2.5%');
  const closedImage=await page.locator('#preview').getAttribute('src');
  await page.locator('#pose').selectOption('both-10');
  await expect(page.locator('#caption')).toContainText('10%');
  expect(await page.locator('#preview').getAttribute('src')).not.toBe(closedImage);
  await page.clock.install();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('再生を停止');
  await page.clock.runFor(1500);
  expect(await page.locator('#pose').inputValue()).not.toBe('default');
  await page.locator('#next').click();
  await expect(page.locator('#play')).toHaveText('自動で切り替える');
  const paused=await page.locator('#pose').inputValue();
  await page.clock.runFor(5000);
  await expect(page.locator('#pose')).toHaveValue(paused);
  await page.locator('#area').selectOption('full');
  await page.locator('#background').selectOption('checker');
  await expect(page.locator('#board')).toHaveClass('board checker');
  expect(errors).toEqual([]);
  expect(requests).toEqual(['http://127.0.0.1:5173/private-preview-fixture']);
});

test('saved work and model retain their bytes; portrait and landscape controls fit',async({page})=>{
  const {errors}=await open(page);
  for(const [name,bytes] of [['作業ファイルを保存',work],['試作モデルを保存',model]]){
    const downloading=page.waitForEvent('download');
    await page.getByRole('link',{name,exact:true}).click();
    const download=await downloading,chunks=[];
    for await(const chunk of await download.createReadStream())chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(bytes);
  }
  for(const size of [{width:320,height:640},{width:844,height:390}]){
    await page.setViewportSize(size);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const controls=await page.locator('button,select,a').evaluateAll(es=>es.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})));
    expect(controls.every(c=>c.height>=48 && c.font>=16)).toBe(true);
  }
  expect(errors).toEqual([]);
});

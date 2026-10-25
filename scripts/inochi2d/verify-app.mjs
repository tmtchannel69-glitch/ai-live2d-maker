// Actual local browser -> API -> existing head CLI -> model ZIP. No model or
// image downloads, external hosts, creator/appearance auto-approval or Git writes.
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';

const {values}=parseArgs({options:{source:{type:'string'},output:{type:'string'},url:{type:'string',default:'http://127.0.0.1:5180'}}});
if(!values.source||!values.output)throw new Error('Usage: verify-app.mjs --source LOCAL_IMAGE --output NEW_PRIVATE_DIR [--url LOCAL_APP_URL]');
const root=await realpath(fileURLToPath(new URL('../../',import.meta.url))),parent=await realpath(dirname(resolve(values.output))),output=join(parent,resolve(values.output).split(sep).at(-1));
if(output===root||output.startsWith(root+sep))throw new Error('Images/models must stay outside Git.');
const url=new URL(values.url);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw new Error('Use a local HTTP app URL only.');
const stat=await lstat(values.source);if(!stat.isFile()||stat.size>10*1024*1024)throw new Error('Use a regular local image <=10MiB.');
const source=await readFile(values.source),sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(output,{mode:0o700});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),requests=[];
let external=0;
await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==url.origin){external++;return route.abort();}return route.continue();});
page.on('request',request=>{
  const u=new URL(request.url());if(u.pathname==='/api/inochi2d/generate'&&request.method()==='POST'){
    assert.equal(u.searchParams.get('mode'),'detailed-head');assert.equal(sha(request.postDataBuffer()),sha(source));
    requests.push({mode:u.searchParams.get('mode'),bytes:source.length,sha256:sha(source)});
  }
});
async function waitText(text,timeout=10000){await page.waitForFunction(t=>document.querySelector('#inochi-model-status')?.textContent.includes(t),text,{timeout});}
async function work(){
  const next=page.waitForEvent('download');await page.locator('#save-project').click();const d=await next,parts=[];
  for await(const part of await d.createReadStream())parts.push(part);return unzipSync(Buffer.concat(parts));
}
async function readyAgain(){
  for(let i=0;i<100;i++){
    const status=await context.request.get(new URL('/api/inochi2d/status?mode=detailed-head',url).href);
    if(!(await status.json()).busy)return;
    await page.waitForTimeout(100);
  }throw new Error('Backend stayed busy after browser cancellation.');
}
try{
  await page.goto(url.href);await page.locator('#file').setInputFiles(resolve(values.source));
  await page.locator('#separate').click();await page.waitForSelector('.result-card');
  const before=await work();await page.locator('#inochi-model-mode').selectOption('detailed-head');
  assert.equal(requests.length,0);await page.locator('#inochi-model-check').click();await waitText('準備ができています');assert.equal(requests.length,0);
  const sent=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/inochi2d/generate'&&r.method()==='POST');
  await page.locator('#inochi-model-start').click();await sent;
  let observedBusy=false;
  for(let i=0;i<50;i++){
    const status=await context.request.get(new URL('/api/inochi2d/status?mode=detailed-head',url).href);
    if((await status.json()).busy){observedBusy=true;break;}
    await page.waitForTimeout(100);
  }
  assert.equal(observedBusy,true,'The backend must have accepted the job before testing cancellation.');
  await page.waitForTimeout(800);
  await page.locator('#inochi-model-cancel').click();await waitText('中止');await readyAgain();assert.deepEqual(await work(),before);
  const started=performance.now();await page.locator('#inochi-model-start').click();
  await page.waitForSelector('.inochi-model-panel[aria-busy="false"]',{timeout:620000});await waitText('モデルを生成しました');
  const generationSeconds=(performance.now()-started)/1000;
  assert.deepEqual(await work(),before);assert.equal(requests.length,2);
  const next=page.waitForEvent('download');await page.locator('#inochi-model-download').click();const download=await next;
  assert.equal(download.suggestedFilename(),'inochi2d-head-neck-body.zip');const path=join(output,'model.zip');await download.saveAs(path);
  const bytes=await readFile(path);assert.ok(bytes.length<=80*1024*1024);const files=unzipSync(bytes);
  assert.ok(Object.keys(files).length<=256);assert.ok(Object.values(files).reduce((n,b)=>n+b.length,0)<=80*1024*1024);
  assert.equal(Buffer.from(files['model.inp'].subarray(0,8)).toString('latin1'),'TRNSRTS\0');
  assert.deepEqual(files['model.inp'],files['model.inx']);
  assert.ok(Object.keys(files).every(n=>!n.endsWith('.jpg')&&!n.includes('source-image')&&!n.includes('reconstruction')));
  assert.ok(Object.values(files).every(b=>sha(b)!==sha(source)));
  const pipeline=JSON.parse(strFromU8(files['generation-report.json']));assert.equal(pipeline.mode,'detailed-head');assert.equal(pipeline.officialCreatorTested,false);
  assert.equal(pipeline.containsUploadedOriginalFile,false);assert.equal(external,0);
  const review=JSON.parse(strFromU8(files['review/review.json']));assert.equal(review.renderer,'independent-cpu-serialized-model');
  assert.equal(review.model_sha256,sha(files['model.inp']));assert.equal(review.official_creator_tested,false);assert.equal(review.appearance_quality_passed,false);
  assert.equal(review.views.reduce((n,v)=>n+v.frames.length,0),20);
  async function checkImage(frame){
    await page.locator('#inochi-review-image').evaluate(image=>image.decode());
    const digest=await page.locator('#inochi-review-image').evaluate(async image=>{
      const bytes=await (await fetch(image.src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    });assert.equal(digest,sha(files[frame.file]));
  }
  for(const view of review.views){
    await page.locator('#inochi-review-view').selectOption(view.id);
    for(const frame of view.frames){await checkImage(frame);await page.locator('#inochi-review-next').click();}
  }
  await page.locator('#inochi-review-parts summary').click();assert.equal(await page.locator('#inochi-review-part option').count(),38);
  await page.locator('#inochi-review-part').selectOption({label:'頭の表面 — head_surface'});
  await page.locator('#inochi-review-part-image').evaluate(image=>image.decode());
  await page.locator('#inochi-review-view').selectOption('head');
  await page.locator('.inochi-model-panel').scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'phone-result.png'),fullPage:true});
  await page.locator('#inochi-model-result').screenshot({path:join(output,'model-review.png')});
  assert.deepEqual(await work(),before);
  // Reopen in a fresh page without the source; API access is blocked to prove
  // that review is local, not a hidden upload or a second generation.
  const reopened=await context.newPage();let reopenApiCalls=0;
  await reopened.route('**/api/**',route=>{reopenApiCalls++;return route.abort();});
  await reopened.goto(url.href);await reopened.locator('#inochi-model-open-file').setInputFiles(path);
  await reopened.waitForFunction(()=>document.querySelector('#inochi-model-status').textContent.includes('モデルZIPを開きました'));
  await reopened.locator('#inochi-review-image').evaluate(image=>image.decode());assert.equal(reopenApiCalls,0);
  assert.equal(await reopened.locator('#inochi-model-start').isDisabled(),true);assert.equal(requests.length,2);
  await reopened.close();
  const report={format:'ai-live2d-detailed-head-live-app-check',version:2,source_sha256:sha(source),local_url:url.origin,
    actual_image_posts:requests.length,cancelled_posts:1,completed_posts:1,readiness_sent_images:false,
    backend_busy_observed_before_cancel:true,cancel_released_backend_lock:true,existing_work_entries_unchanged:true,archive_entries:Object.keys(files).length,
    archive_bytes:bytes.length,archive_sha256:sha(bytes),model_sha256:sha(files['model.inp']),source_file_in_archive:false,
    external_hosts_requested:external,completed_generation_seconds:generationSeconds,total_review_seconds:(performance.now()-started)/1000,
    model_review_frames_checked:20,model_review_frame_bytes_match_archive:true,model_review_parts:38,
    saved_zip_reopened_without_source:true,reopen_api_calls:reopenApiCalls,
    file_generation_passed:true,official_creator_tested:false,appearance_quality_passed:false};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(output,'failure.json'),JSON.stringify({error:error.message,requests,external}));throw error;}
finally{await browser.close();}

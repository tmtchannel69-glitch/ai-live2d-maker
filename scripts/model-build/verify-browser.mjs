// Requires Vite:5173 and the configured local model-build service:8001.
// Only uses the app's self-contained synthetic sample, never a user's image.
import {chromium} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const output=await mkdtemp(join(tmpdir(),'live2d-model-browser-')),browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await page.goto('http://127.0.0.1:5173');await page.locator('#try-sample').click();await page.locator('#scene-inspect').waitFor();await page.locator('#model-build-check').click();
  await page.waitForFunction(()=>!document.querySelector('#model-build-start').disabled,{timeout:10000});
  const event=page.waitForEvent('download',{timeout:180000});await page.locator('#model-build-start').click();const d=await event,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);const bytes=Buffer.concat(chunks),entries=unzipSync(bytes),report=JSON.parse(strFromU8(entries['AI_LIVE2D_BUILD_REPORT.json']));
  assert.ok(entries[report.moc]?.length>64);assert.ok(report.independentRuntime?.consistency);assert.ok(report.independentRuntime.finite_default_and_all_parameter_extrema);assert.ok(report.independentRuntime.drawable_count>0);assert.equal(report.vtubeStudioTested,false);
  await writeFile(join(output,'sample-model.zip'),bytes);await writeFile(join(output,'build-report.json'),JSON.stringify(report,null,2));await page.locator('#model-build-status').scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'model-build-phone.png')});
  console.log(JSON.stringify({output,mocBytes:entries[report.moc].length,drawables:report.independentRuntime.drawable_count,vertices:report.independentRuntime.vertex_count,parameters:report.independentRuntime.parameters.map(p=>({id:p.id,delta:Math.max(...p.max_output_delta_samples)})),officialCoreTested:false,vtubeStudioTested:false},null,2));
}finally{await browser.close();}

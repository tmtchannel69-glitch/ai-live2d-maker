import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
test.use({hasTouch:true,isMobile:true});
async function setup(page){await page.goto('/?mode=convert');await page.locator('#try-sample').click();await expect(page.locator('#scene-inspect')).toBeEnabled();}
async function save(page){const event=page.waitForEvent('download');await page.locator('#save-project').click();const d=await event,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);return unzipSync(Buffer.concat(chunks));}
const pixels=page=>page.locator('#inspector-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
test('temporary hiding and source-only comparison render real pixels while preserving saved material and note state',async({page})=>{
  await setup(page);const before=await save(page);await page.locator('#scene-inspect').click();await page.locator('#inspector-role').selectOption('mouth_inside');
  await page.locator('#inspector-mouth').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('input'));});const normal=await pixels(page);
  await page.locator('#inspector-overlap').selectOption('without');expect(await pixels(page)).not.toEqual(normal);await expect(page.locator('#expression-note-record')).toBeDisabled();await expect(page.locator('#inspector-isolate')).toBeDisabled();
  await page.locator('#inspector-overlap').selectOption('normal');expect(await pixels(page)).toEqual(normal);await expect(page.locator('#expression-note-record')).toBeEnabled();await page.locator('#inspector-isolate').check();const isolated=await pixels(page);await page.locator('#inspector-overlap').selectOption('source');const source=await pixels(page);expect(source).not.toEqual(isolated);
  // Compare against the actual source PNG stored in the existing work archive.
  const meta=JSON.parse(strFromU8(before['project.json']));const sourceKey=Object.keys(before).find(k=>k.startsWith('source.')) || meta.source?.path;
  expect(sourceKey).toBeTruthy();const expected=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),b=await createImageBitmap(new Blob([bytes],{type:'image/png'})),c=document.createElement('canvas'),target=document.querySelector('#inspector-canvas');c.width=target.width;c.height=target.height;c.getContext('2d').drawImage(b,0,0,c.width,c.height);b.close();return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);},Buffer.from(before[sourceKey]).toString('base64'));expect(source).toEqual(expected);
  await page.locator('#inspector-mouth').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input'));});expect(await pixels(page)).toEqual(source);
  await page.locator('#inspector-overlap').selectOption('normal');await expect(page.locator('#inspector-isolate')).toBeChecked();await page.locator('#inspector-close').click();const after=await save(page);expect(after).toEqual(before);
});
test('overlap modes share comparison framing, reset on reopen and fit small portrait and landscape phones',async({page})=>{
  await setup(page);await page.locator('#scene-inspect').click();await page.locator('#inspector-role').selectOption('mouth_inside');await page.locator('#inspector-compare').click();
  const card=page.locator('.comparison-card canvas').first();const normal=await card.evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
  await page.locator('#inspector-overlap').selectOption('source');const original=await card.evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));expect(original).not.toEqual(normal);await expect(page.locator('#comparison-status')).toContainText('同じ範囲');await expect(page.locator('.comparison-card').last().locator('p')).not.toContainText('非表示');
  await page.locator('#comparison-pose-1').click();await expect(page.locator('#inspector-overlap')).toHaveValue('source');await expect(page.locator('#expression-note-record')).toBeDisabled();
  for(const size of [{width:320,height:640},{width:844,height:390}]){await page.setViewportSize(size);await page.locator('#inspector-overlap').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('#inspector-overlap').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);expect(await page.locator('#inspector-overlap').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);}
  await page.keyboard.press('Escape');await page.locator('#scene-inspect').click();await expect(page.locator('#inspector-overlap')).toHaveValue('normal');await expect(page.locator('#expression-note-record')).toBeEnabled();await page.evaluate(()=>document.querySelector('#reset').click());await expect(page.locator('#expression-inspector')).not.toBeVisible();expect((await pixels(page)).every(v=>v===0)).toBe(true);
});

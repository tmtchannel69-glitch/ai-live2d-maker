import {test,expect} from '@playwright/test';
import {encode} from 'fast-png';
const data=new Uint8Array(100*150*4);data.set([210,30,80,255],(30*100+20)*4);
const png=Buffer.from(encode({width:100,height:150,data,channels:4,depth:8}));
test('copy chooser shows real pixels, target and preparation guidance without importing until requested',async({page})=>{
  await page.goto('/');await page.locator('#file').setInputFiles({name:'source.png',mimeType:'image/png',buffer:png});
  await page.locator('#processing-mode').selectOption('ai');for(const id of ['face','body','eyes'])await page.locator(`.part-options input[value=${id}]`).uncheck();
  await page.locator('#edit-prompts').click();await page.locator('#prompt-dialog svg').click({position:{x:50,y:50}});await page.locator('#close-prompts').click();
  await page.route('**/api/separate',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({parts:[{id:'hair',png:png.toString('base64')}]})}));await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(1);
  expect(await page.locator('#asset-result-canvas').evaluate(c=>c.width)).toBe(1);
  await page.locator('#asset-role').selectOption('face_base');await expect(page.locator('#asset-role-advice')).toContainText('目・口の絵が残らない');await page.locator('.asset-result-import summary').click();
  await expect(page.locator('#asset-result-preview-status')).toContainText('100 × 150');expect(await page.locator('#asset-result-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(20,30,1,1).data))).toEqual([210,30,80,255]);
  await expect(page.locator('#asset-copy-target')).toContainText('下地の肌');await expect(page.locator('#asset-inventory')).toContainText('0 / 15');
  await page.locator('#asset-role').selectOption('mouth_closed');await expect(page.locator('#asset-role-advice')).toContainText('閉じた絵にはなりません');
  await page.locator('#asset-use-result').click();await expect(page.locator('#asset-status')).toContainText('コピーしました');await expect(page.locator('#asset-copy-target')).toContainText('現在の素材を置き換え');
  await page.setViewportSize({width:320,height:640});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('#asset-result').evaluate(c=>c.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  await page.locator('.asset-result-import summary').click();await expect.poll(()=>page.locator('#asset-result-canvas').evaluate(c=>c.width)).toBe(1);
  await page.locator('.asset-result-import summary').click();await expect(page.locator('#asset-result-preview-status')).toContainText('100 × 150');await page.locator('#reset').click();await expect.poll(()=>page.locator('#asset-result-canvas').evaluate(c=>c.width)).toBe(1);
});
test('bounded result preview releases stale decodes and recovers after invalid PNG',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createMaterialAssignmentPreview}=await import('/src/material-assignment-preview.js');
    const details=document.createElement('details'),canvas=document.createElement('canvas'),status=document.createElement('p');details.open=true;
    const source=new Blob(['source']),c=new OffscreenCanvas(1200,1800);c.getContext('2d').fillRect(0,0,1200,1800);const blob=await c.convertToBlob({type:'image/png'});let selection={file:source,part:{blob}};
    const real=createImageBitmap;let resolve,closed=0;window.createImageBitmap=async(...args)=>{const bitmap=await real(...args);await new Promise(r=>resolve=r);return {width:bitmap.width,height:bitmap.height,close(){closed++;bitmap.close();}};};
    const preview=createMaterialAssignmentPreview({details,canvas,status,getSelection:()=>selection});preview.update();while(!resolve)await new Promise(r=>setTimeout(r,5));details.open=false;preview.update();resolve();await new Promise(r=>setTimeout(r,20));const stale={width:canvas.width,closed};window.createImageBitmap=real;
    details.open=true;selection={file:source,part:{blob:new Blob(['bad'])}};preview.update();while(!status.textContent.includes('表示できません'))await new Promise(r=>setTimeout(r,5));const error=status.textContent;
    selection={file:source,part:{blob}};preview.update();while(!status.textContent.includes('1200 × 1800'))await new Promise(r=>setTimeout(r,5));const bounded={width:canvas.width,height:canvas.height};preview.clear();return {stale,error,bounded,cleared:canvas.width};
  });expect(result.stale).toEqual({width:1,closed:1});expect(result.error).toContain('元の分離結果は保持');expect(result.bounded).toEqual({width:320,height:480});expect(result.cleared).toBe(1);
});

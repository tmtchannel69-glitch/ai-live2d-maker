import { test, expect } from '@playwright/test';
import {readPsd,initializeCanvas} from 'ag-psd';
initializeCanvas(()=>{throw new Error('Use raw image data');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));

test('actual local SAM returns a full-size transparent PNG through the browser', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/?mode=convert');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width=256; canvas.height=384;
    const context=canvas.getContext('2d'); context.fillStyle='white';context.fillRect(0,0,256,384);
    context.fillStyle='purple'; context.beginPath();context.ellipse(128,190,75,140,0,0,Math.PI*2);context.fill();
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')});
  await page.locator('#processing-mode').selectOption('ai');
  for (const id of ['face','body','eyes']) await page.locator(`input[value="${id}"]`).uncheck();
  await page.getByRole('button',{name:'切り抜く場所を指定'}).click();
  await page.locator('#prompt-kind').selectOption('box');
  await page.getByText('数値で指定（キーボード操作）').click();
  for (const [name,value] of Object.entries({x:'20',y:'13',right:'80',bottom:'87'})) await page.locator(`input[name="${name}"]`).fill(value);
  await page.getByRole('button',{name:'数値を反映'}).click();
  for (const [kind,x,y] of [['point','50','50'],['exclude','0','0']]) {
    await page.locator('#prompt-kind').selectOption(kind);
    await page.locator('input[name="x"]').fill(x); await page.locator('input[name="y"]').fill(y);
    await page.getByRole('button',{name:'数値を反映'}).click();
  }
  await expect(page.locator('svg circle')).toHaveCount(2);
  await page.locator('#close-prompts').click();
  await page.getByRole('button',{name:/AI でパーツを分離/}).click();
  await expect(page.locator('#status')).toContainText('1 個のAI 試作',{timeout:90000});
  await expect(page.locator('.result-card')).toHaveCount(1);
  const image=page.locator('.result-card img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth===256 && img.naturalHeight===384)).toBe(true);
  const alpha=await image.evaluate(img => {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=384;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    return [ctx.getImageData(0,0,1,1).data[3],ctx.getImageData(128,190,1,1).data[3]];
  });
  expect(alpha[0]).toBe(0); expect(alpha[1]).toBeGreaterThan(0);
  const pending=page.waitForEvent('download');await page.locator('#save-project').click();const download=await pending;
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  await page.reload();await page.locator('#project-file').setInputFiles({name:'ai-live2d-work.zip',mimeType:'application/zip',buffer:Buffer.concat(chunks)});
  await expect(page.locator('#project-status')).toContainText('作業を再開');
  const restored=page.locator('.result-card img');await expect.poll(()=>restored.evaluate(img=>img.complete&&img.naturalWidth===256&&img.naturalHeight===384)).toBe(true);
  const restoredAlpha=await restored.evaluate(img=>{const c=document.createElement('canvas');c.width=256;c.height=384;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return[ctx.getImageData(0,0,1,1).data[3],ctx.getImageData(128,190,1,1).data[3]];});
  expect(restoredAlpha).toEqual(alpha);
  const legacyUrl=await restored.getAttribute('src');
  await page.locator('#parts-template').selectOption('production');await page.locator('input[value="eye_l"]').check();
  await page.locator('#edit-prompts').click();await page.locator('#prompt-part').selectOption('eye_l');
  await page.getByText('数値で指定（キーボード操作）').click();await page.locator('#prompt-kind').selectOption('box');
  for(const [name,value] of Object.entries({x:'20',y:'13',right:'80',bottom:'87'}))await page.locator(`#coordinate-form input[name="${name}"]`).fill(value);
  await page.getByRole('button',{name:'数値を反映'}).click();await page.locator('#close-prompts').click();
  await page.locator('#separate').click();await expect(page.locator('#status')).toContainText('1 個のAI 試作',{timeout:90000});
  await expect(page.locator('[data-part=eye_l] img')).toBeVisible();
  await expect.poll(()=>page.locator('[data-part=eye_l] img').evaluate(img=>img.complete&&img.naturalWidth===256&&img.naturalHeight===384)).toBe(true);
  await page.locator('#parts-template').selectOption('basic');expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(legacyUrl);
  await page.locator('#parts-template').selectOption('production');
  const saved=page.waitForEvent('download');await page.locator('#save-project').click();const v2=await saved,bytes=[];
  for await(const chunk of await v2.createReadStream())bytes.push(chunk);
  await page.reload();await page.locator('#project-file').setInputFiles({name:'work.zip',mimeType:'application/zip',buffer:Buffer.concat(bytes)});
  await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#parts-template')).toHaveValue('production');await expect(page.locator('[data-part=eye_l] img')).toBeVisible();
  await page.locator('#parts-template').selectOption('basic');await expect(page.locator('[data-part=hair] img')).toBeVisible();
  // Continue with real SAM bytes through the new material and PSD workflow.
  async function saveOutput(selector){const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);return Buffer.concat(chunks);}
  const raw=await saveOutput('[data-part=hair] a');await page.locator('#asset-role').selectOption('face_base');await page.locator('.asset-result-import summary').click();await page.locator('#asset-result').selectOption('hair');await page.locator('#asset-use-result').click();await expect(page.locator('#asset-status')).toContainText('コピーしました');await expect(page.locator('#asset-width')).toHaveValue('100');expect(await saveOutput('#asset-download')).toEqual(raw);
  const psd=readPsd(await saveOutput('#download-expression-psd'),{useImageData:true,skipThumbnail:true});expect([psd.width,psd.height]).toEqual([256,384]);expect(psd.children[0].name).toBe('目・口の下地の肌 [face_base]');expect(psd.children[0].imageData.data[3]).toBe(0);expect(psd.children[0].imageData.data[(190*256+128)*4+3]).toBeGreaterThan(0);
  const work=await saveOutput('#save-project');await page.reload();await page.locator('#project-file').setInputFiles({name:'work.zip',mimeType:'application/zip',buffer:work});await expect(page.locator('#project-status')).toContainText('作業を再開');await page.locator('#asset-role').selectOption('face_base');expect(await saveOutput('#asset-download')).toEqual(raw);
  await page.screenshot({path:'/tmp/live2d-real-ai-mobile.png',fullPage:true});
});

import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

async function setup(page) {
  await page.goto('/?mode=convert');
  const images = await page.evaluate(() => {
    const c=document.createElement('canvas');c.width=c.height=200;const ctx=c.getContext('2d');
    ctx.fillStyle='#8040c0';ctx.fillRect(0,0,200,200);
    ctx.clearRect(0,140,200,20);ctx.fillStyle='rgba(10,200,30,0.5)';ctx.fillRect(0,140,200,20);
    ctx.clearRect(0,170,20,30);
    const source=c.toDataURL().split(',')[1];ctx.clearRect(100,0,100,200);
    return {source,part:c.toDataURL().split(',')[1]};
  });
  await page.locator('#file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(images.source,'base64')});
  await page.locator('#processing-mode').selectOption('ai');
  for(const id of ['body','eyes'])await page.locator(`input[value="${id}"]`).uncheck();
  await page.locator('#edit-prompts').click();
  for(const id of ['hair','face']) {await page.locator('#prompt-part').selectOption(id);await page.locator('#prompt-dialog svg').click({position:{x:30,y:30}});}
  await page.locator('#close-prompts').click();
  await page.route('**/api/separate',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({parts:['hair','face'].map(id=>({id,png:images.part}))})}));
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(2);
}
async function open(page) {
  await page.getByRole('button',{name:'髪をブラシで補正',exact:true}).click();
  await expect(page.locator('#brush-status')).toContainText('なぞって');
}
async function dot(page,x,y,tool) {
  await page.locator('#brush-tool').selectOption(tool);
  if(!await page.locator('#brush-coordinate-form').isVisible())await page.getByText('数値でブラシを置く（キーボード操作）').click();
  await page.locator('#brush-coordinate-form input[name=brushx]').fill(String(x));await page.locator('#brush-coordinate-form input[name=brushy]').fill(String(y));
  await page.getByRole('button',{name:'ブラシを置く',exact:true}).click();
}
async function canvasPixel(page,x,y) {
  return page.locator('#brush-canvas').evaluate((c,[x,y])=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data),[x,y]);
}
async function pngPixels(page,bytes) {
  return page.evaluate(async base64=>{
    const img=await createImageBitmap(await (await fetch('data:image/png;base64,'+base64)).blob());
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);img.close();
    return {size:[c.width,c.height],pixels:[[50,50],[150,50],[50,150],[10,180],[30,30]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data))};
  },bytes.toString('base64'));
}
async function bytes(download){const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}

test('brush restores source pixels and exports corrected PNG/ZIP without comparison overlay',async({page})=>{
  await setup(page);const face=await page.locator('[data-part=face] img').getAttribute('src');await open(page);
  await dot(page,25,25,'erase');expect((await canvasPixel(page,50,50))[3]).toBe(0);
  await page.locator('#brush-undo').click();expect((await canvasPixel(page,50,50))[3]).toBe(255);
  await page.locator('#brush-redo').click();expect((await canvasPixel(page,50,50))[3]).toBe(0);
  await dot(page,75,25,'restore');expect(await canvasPixel(page,150,50)).toEqual([128,64,192,255]);
  await dot(page,5,90,'restore');expect((await canvasPixel(page,10,180))[3]).toBe(0);
  expect((await canvasPixel(page,50,150))[3]).toBe(128);
  await page.locator('#brush-view').selectOption('before');expect((await canvasPixel(page,50,50))[3]).toBe(255);
  await expect(page.getByRole('button',{name:'ブラシを置く',exact:true})).toBeDisabled();
  await page.locator('#brush-view').selectOption('edited');await page.locator('#brush-overlay').check();
  expect((await canvasPixel(page,50,50))[3]).toBeGreaterThan(0);
  await page.locator('#brush-apply').click();await expect(page.locator('#brush-dialog')).not.toBeVisible();
  expect(await page.locator('[data-part=face] img').getAttribute('src')).toBe(face);
  await expect(page.locator('[data-part=hair] .result-state')).toContainText('ブラシ補正済み');
  const pngWait=page.waitForEvent('download');await page.getByRole('link',{name:'髪をダウンロード'}).click();const png=await bytes(await pngWait);
  const decoded=await pngPixels(page,png);expect(decoded.size).toEqual([200,200]);
  expect(decoded.pixels[0][3]).toBe(0);expect(decoded.pixels[1]).toEqual([128,64,192,255]);expect(decoded.pixels[2][3]).toBe(128);expect(decoded.pixels[3][3]).toBe(0);expect(decoded.pixels[4]).toEqual([128,64,192,255]);
  const zipWait=page.waitForEvent('download');await page.locator('#download-all').click();const archive=unzipSync(await bytes(await zipWait));
  expect(Buffer.from(archive['hair.png'])).toEqual(png);expect(Object.keys(archive).sort()).toEqual(['face.png','hair.png']);
  await page.getByRole('button',{name:'髪を修正',exact:true}).click();await expect(page.locator('#prompt-result-note')).toContainText('置き換え');
});

test('zoomed pointer brush, cancelled gestures, comparison and discarded drafts are safe on mobile',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await setup(page);const previous=await page.locator('[data-part=hair] img').getAttribute('src');await open(page);
  await page.locator('#brush-zoom').selectOption('2');await page.locator('#brush-tool').selectOption('pan');
  await expect(page.locator('#brush-canvas')).toHaveCSS('touch-action','auto');
  const viewport=page.locator('.brush-viewport');await viewport.scrollIntoViewIfNeeded();const v=await viewport.boundingBox();
  const session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:v.x+220,y:v.y+100}]});
  for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:v.x+220-i*18,y:v.y+100}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>viewport.evaluate(el=>el.scrollLeft)).toBeGreaterThan(50);await session.detach();
  await viewport.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});
  await page.locator('#brush-tool').selectOption('erase');const c=page.locator('#brush-canvas');const box=await c.boundingBox();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.1,{steps:4});await page.mouse.up();
  expect((await canvasPixel(page,40,20))[3]).toBe(0);await page.locator('#brush-undo').click();expect((await canvasPixel(page,40,20))[3]).toBe(255);
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.1);await page.mouse.down();
  await c.dispatchEvent('pointercancel',{pointerId:1,isPrimary:true});await page.mouse.up();expect((await canvasPixel(page,40,20))[3]).toBe(255);
  await dot(page,25,25,'erase');await page.keyboard.press('Escape');
  expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(previous);
  await open(page);expect((await canvasPixel(page,50,50))[3]).toBe(255);await expect(page.locator('#brush-undo')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#brush-cancel').click();await page.locator('#reset').click();await expect(page.locator('.brush-part')).toHaveCount(0);expect(errors).toEqual([]);
});

test('PNG export failure retains draft and old result; closing rejects late export',async({page})=>{
  await setup(page);const previous=await page.locator('[data-part=hair] img').getAttribute('src');await open(page);await dot(page,25,25,'erase');
  await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};});
  await page.locator('#brush-apply').click();await expect(page.locator('#brush-status')).toContainText('反映に失敗');
  expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(previous);await expect(page.locator('#brush-apply')).toBeEnabled();
  expect((await canvasPixel(page,50,50))[3]).toBe(0);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=function(callback,...rest){window.originalToBlob.call(this,blob=>setTimeout(()=>callback(blob),300),...rest);};});
  await page.locator('#brush-apply').click();await page.locator('#brush-cancel').click();await page.locator('#reset').click();
  await page.waitForTimeout(500);await expect(page.locator('.result-card')).toHaveCount(0);await expect(page.locator('#status')).toContainText('まずは');
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.originalToBlob;});
});

test('bounded brush history keeps earlier edits after the last undoable action',async({page})=>{
  await page.goto('/?mode=convert');
  const result=await page.evaluate(async()=>{
    const {createBrushMask}=await import('/src/brush-mask.js');const c=document.createElement('canvas');c.width=c.height=256;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,256,256);const state=createBrushMask(c);
    state.begin({x:20,y:20},'erase',10);state.finish();
    for(let i=0;i<101;i++){state.begin({x:140,y:140},i%2?'restore':'erase',10);state.finish();}
    let undos=0;while(state.canUndo){state.undo();undos++;}
    return {undos,changed:state.changed,limited:state.limited,earlyAlpha:ctx.getImageData(20,20,1,1).data[3],canRedo:state.canRedo};
  });
  expect(result).toEqual({undos:100,changed:true,limited:true,earlyAlpha:0,canRedo:true});
});

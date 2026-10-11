import {test,expect} from '@playwright/test';
import {unzipSync} from 'fflate';
test.use({hasTouch:true,isMobile:true});
async function sample(page){await page.goto('/');await page.locator('#try-sample').click();await expect(page.locator('#scene-inspect')).toBeEnabled();await page.locator('#scene-inspect').click();}
async function save(page){const event=page.waitForEvent('download');await page.locator('#save-project').click();const chunks=[];for await(const c of await(await event).createReadStream())chunks.push(c);return unzipSync(Buffer.concat(chunks));}
const pixels=page=>page.locator('#inspector-canvas').evaluate(async c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let area=0;for(let i=3;i<data.length;i+=4)if(data[i]>0)area++;const digest=await crypto.subtle.digest('SHA-256',data);return {area,hash:Array.from(new Uint8Array(digest))};});

test('detail rereads original fine lines, preserves view center and raw saved work, then releases textures',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=768;c.height=1024;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,768,1024);ctx.fillStyle='black';for(let n=0;n<24;n++)ctx.fillRect(300+n*4,480,2,80);return c.toDataURL().split(',')[1];});
  const image={name:'lines.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};await page.locator('#file').setInputFiles(image);await page.locator('#asset-role').selectOption('face_base');await page.locator('#asset-file').setInputFiles(image);await expect(page.locator('#scene-inspect')).toBeEnabled();const before=await save(page);
  await page.locator('#scene-inspect').click();await page.locator('#inspector-focus').click();
  const contrast=()=>page.locator('#inspector-canvas').evaluate(c=>{const ctx=c.getContext('2d'),samples=[];for(let n=1;n<23;n++){const black=ctx.getImageData(Math.floor((301+n*4)/768*c.width),Math.floor(512/1024*c.height),1,1).data[0],white=ctx.getImageData(Math.floor((303+n*4)/768*c.width),Math.floor(512/1024*c.height),1,1).data[0];samples.push(white-black);}return samples.reduce((a,b)=>a+b)/samples.length;});
  await page.evaluate(()=>{const original=window.createImageBitmap;window.closedDetails=0;window.createImageBitmap=async(...args)=>{const b=await original(...args),close=b.close.bind(b);b.close=()=>{window.closedDetails++;close();};return b;};});
  const ordinary=await contrast(),position=await page.locator('#inspector-viewport').evaluate(e=>[e.scrollLeft,e.scrollTop]);
  await page.locator('#inspector-detail').click();await expect(page.locator('#inspector-detail')).toHaveAttribute('aria-pressed','true');expect(await contrast()).toBeGreaterThan(ordinary+60);
  expect(await page.locator('#inspector-canvas').evaluate(c=>[c.width,c.height])).toEqual([1280,1706]);expect(await page.locator('#inspector-viewport').evaluate(e=>[e.scrollLeft,e.scrollTop])).toEqual(position);await expect(page.locator('#inspector-zoom')).toHaveValue('4');
  await page.locator('#inspector-detail').click();expect(await contrast()).toBe(ordinary);expect(await page.evaluate(()=>window.closedDetails)).toBe(2);await page.locator('#inspector-close').click();const after=await save(page);expect(Buffer.from(after['project.json'])).toEqual(Buffer.from(before['project.json']));expect(Buffer.from(after['expressions/face_base.png'])).toEqual(image.buffer);expect(errors).toEqual([]);
});

test('detail combines clipping, mesh and group poses, errors retain ordinary view and allow retry',async({page})=>{
  await sample(page);const ordinary=await pixels(page);
  await page.evaluate(()=>{window.bitmapOriginal=window.createImageBitmap;window.createImageBitmap=async()=>{throw new Error('test decode failure');};});await page.locator('#inspector-detail').click();await expect(page.locator('#inspector-detail-status')).toContainText('もう一度');expect(await pixels(page)).toEqual(ordinary);
  await page.evaluate(()=>{window.createImageBitmap=window.bitmapOriginal;});await page.locator('#inspector-detail').click();await expect(page.locator('#inspector-detail')).toHaveAttribute('aria-pressed','true');
  await page.locator('#inspector-role').selectOption('mouth_inside');await page.locator('#inspector-isolate').check();await page.locator('#inspector-mouth').fill('1');const open=(await pixels(page)).area;await page.locator('#inspector-mouth').fill('0');expect((await pixels(page)).area).toBeLessThan(open);
  await page.locator('#inspector-mouth').fill('1');const centered=await pixels(page);await page.locator('#inspector-turn').fill('1');expect(await pixels(page)).not.toEqual(centered);await page.locator('#inspector-reference').check();expect((await pixels(page)).area).toBeGreaterThan(open);
  await page.locator('#inspector-reference').uncheck();await page.locator('#inspector-edit-deform').click();await expect(page.locator('#scene-role')).toHaveValue('mouth_inside');await expect(page.locator('#scene-turn')).toHaveValue('1');await expect(page.locator('#expression-inspector')).not.toBeVisible();expect(await page.locator('#inspector-canvas').evaluate(c=>[c.width,c.height])).toEqual([240,320]);
});

test('cancelled or closed decoding is released and cannot replace a reopened ordinary view',async({page})=>{
  await sample(page);
  await page.evaluate(()=>{const original=window.createImageBitmap;window.detailFinishes=[];window.detailClosed=0;window.createImageBitmap=async(...args)=>{const b=await original(...args),close=b.close.bind(b);b.close=()=>{window.detailClosed++;close();};await new Promise(resolve=>window.detailFinishes.push(resolve));return b;};});
  await page.locator('#inspector-detail').click();await expect.poll(()=>page.evaluate(()=>window.detailFinishes.length)).toBe(1);await page.locator('#inspector-detail').click();await page.evaluate(()=>window.detailFinishes.shift()());await expect.poll(()=>page.evaluate(()=>window.detailClosed)).toBe(1);await expect(page.locator('#inspector-detail')).toHaveAttribute('aria-pressed','false');
  await page.locator('#inspector-detail').click();await expect.poll(()=>page.evaluate(()=>window.detailFinishes.length)).toBe(1);await page.locator('#inspector-close').click();await page.locator('#scene-inspect').click();const ordinary=await pixels(page);await page.evaluate(()=>window.detailFinishes.shift()());await expect.poll(()=>page.evaluate(()=>window.detailClosed)).toBe(2);expect(await pixels(page)).toEqual(ordinary);await expect(page.locator('#inspector-detail')).toHaveAttribute('aria-pressed','false');
});

test('detail budgets fifteen full canvases and thin textures, and closes partial failed reads',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {detailPlan,DETAIL_PIXEL_BUDGET,loadInspectionDetail}=await import('/src/inspection-detail.js');
    const assets=Array.from({length:15},(_,i)=>({role:String(i),width:i%3===0?4096:2048,height:i%3===0?1:4096,placement:{x:0,y:0,width:1,height:1}}));
    const full=detailPlan(assets.map(a=>({...a,width:2048,height:4096})),1280,1920),thin=detailPlan(assets,1280,1920);
    let calls=0,closed=0;const original=window.createImageBitmap;window.createImageBitmap=async()=>{if(++calls===3)throw new Error('failed');return {close(){closed++;}};};let failed=false;
    try{await loadInspectionDetail({file:new Blob(),assets,width:1280,height:1920,isCurrent:()=>true});}catch{failed=true;}finally{window.createImageBitmap=original;}
    return {budget:DETAIL_PIXEL_BUDGET,counts:[full,thin].map(p=>p.reduce((s,a)=>s+a.width*a.height,0)),failed,calls,closed};
  });
  for(const n of result.counts)expect(n).toBeLessThanOrEqual(result.budget);expect(result.failed).toBe(true);expect(result.calls).toBe(3);expect(result.closed).toBe(2);
});

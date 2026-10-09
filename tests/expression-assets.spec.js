import {test,expect} from '@playwright/test';
import {encode} from 'fast-png';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
function png(width=128,height=192,color=[40,100,200,255]) {
  const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set(color,i);
  return Buffer.from(encode({width,height,data,channels:4,depth:8}));
}
async function setup(page) {
  await page.goto('/');await page.locator('#file').setInputFiles({name:'source.png',mimeType:'image/png',buffer:png()});await expect(page.locator('#source-preview')).toBeVisible();
}
async function asset(page,role='eye_closed_l',bytes=png(16,12,[220,30,60,255])) {
  await page.locator('#asset-role').selectOption(role);await page.locator('#asset-file').setInputFiles({name:`${role}.png`,mimeType:'image/png',buffer:bytes});await expect(page.locator('#asset-status')).toContainText('素材を読み込みました');await expect(page.locator('#asset-apply')).toBeEnabled();
}
async function download(page,selector) {
  const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);return Buffer.concat(chunks);
}
async function open(page,bytes) {await page.locator('#project-file').setInputFiles({name:'work.zip',mimeType:'application/zip',buffer:bytes});}
const pixel=(page,x,y)=>page.locator('#asset-canvas').evaluate((c,[x,y])=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data),[x,y]);

test('expression PNG placement changes actual pixels, preserves raw downloads, and saves roles with existing results',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let requests=0;page.on('request',r=>{if(r.url().includes('/api/separate'))requests++;});await setup(page);await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);const part=await download(page,'[data-part=hair] a');
  const red=png(16,12,[220,30,60,255]);await asset(page,'eye_closed_l',red);await expect(page.locator('#asset-x')).toHaveValue('43.75');expect(await pixel(page,64,96)).toEqual([220,30,60,255]);
  for(const [id,value] of [['x','10'],['y','20'],['width','25'],['height','12.5']])await page.locator(`#asset-${id}`).fill(value);await page.locator('#asset-apply').click();expect(await pixel(page,20,44)).toEqual([220,30,60,255]);expect(await pixel(page,64,96)).toEqual([40,100,200,255]);
  await page.locator('#asset-view').selectOption('transparent');expect(await pixel(page,64,96)).toEqual([0,0,0,0]);expect(await download(page,'#asset-download')).toEqual(red);
  const inside=png(128,192,[20,220,100,128]);await asset(page,'mouth_inside',inside);await expect(page.locator('#asset-x')).toHaveValue('0');await expect(page.locator('#asset-width')).toHaveValue('100');await expect(page.locator('#asset-inventory')).toContainText('2 / 15');await expect(page.locator('#expression-assets-summary')).toContainText('2役割');
  const saved=await download(page,'#save-project'),entries=unzipSync(saved),meta=JSON.parse(strFromU8(entries['project.json']));expect(meta.version).toBe(5);expect(meta.expressions.map(a=>a.role)).toEqual(['eye_closed_l','mouth_inside']);expect(Buffer.from(entries['expressions/eye_closed_l.png'])).toEqual(red);expect(Buffer.from(entries['expressions/mouth_inside.png'])).toEqual(inside);expect(meta.expressions[0].placement).toEqual({x:.1,y:.2,width:.25,height:.125});
  await page.reload();await open(page,saved);await expect(page.locator('#project-status')).toContainText('作業を再開');await page.locator('#asset-role').selectOption('eye_closed_l');await expect(page.locator('#asset-apply')).toBeEnabled();await expect(page.locator('#asset-x')).toHaveValue('10');expect(await download(page,'#asset-download')).toEqual(red);expect(await download(page,'[data-part=hair] a')).toEqual(part);
  const report=(await download(page,'#expression-report')).toString();expect(report).toContain('追加で読み込んだ表情素材');expect(report).toContain('左端10%');expect(report).toContain('動作品質は未確認');
  await page.locator('#asset-remove').click();await expect(page.locator('#asset-inventory')).toContainText('1 / 15');await expect(page.locator('#asset-apply')).toBeDisabled();
  expect(requests).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('invalid replacement and version 5 metadata preserve current assets and old projects clear supplemental materials',async({page})=>{
  await setup(page);const red=png(16,12,[220,30,60,255]);await asset(page,'eye_closed_l',red);const saved=await download(page,'#save-project');
  for(const buffer of [Buffer.from('invalid PNG'),png(4097,1),Buffer.alloc(10*1024*1024+1)]) {
    await page.locator('#asset-file').setInputFiles({name:'bad.png',mimeType:'image/png',buffer});await expect(page.locator('#asset-status')).toContainText('読み込みに失敗');expect(await download(page,'#asset-download')).toEqual(red);
  }
  for(const mutation of [m=>m.expressions[0].role='unknown',m=>m.expressions[0].placement.x=-.1,m=>m.expressions[0].placement.width=0,m=>m.expressions[0].placement.height='1',m=>m.expressions[0].width=17,m=>m.expressions.push(m.expressions[0]),m=>m.expressions[0].path='../source/image',m=>m.expressions[0].placement.extra=true,m=>m.expressions[0].name='bad/path.png']) {
    const e=unzipSync(saved),m=JSON.parse(strFromU8(e['project.json']));mutation(m);e['project.json']=strToU8(JSON.stringify(m));await open(page,Buffer.from(zipSync(e,{level:0})));await expect(page.locator('#project-status')).toContainText('読み込みに失敗');await expect(page.locator('#open-project')).toBeEnabled();await expect(page.locator('#asset-info')).toContainText('eye_closed_l.png');await expect(page.locator('#asset-x')).toHaveValue('43.75');
  }
  expect(await download(page,'#asset-download')).toEqual(red);
  const entries=unzipSync(saved),m=JSON.parse(strFromU8(entries['project.json']));m.version=4;delete m.expressions;delete entries['expressions/eye_closed_l.png'];entries['project.json']=strToU8(JSON.stringify(m));await open(page,Buffer.from(zipSync(entries,{level:0})));await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#asset-inventory')).toContainText('0 / 15');await expect(page.locator('#asset-download')).toBeDisabled();
});

test('reset and source changes cancel delayed expression imports without resurrecting old materials',async({page})=>{
  await setup(page);await asset(page);await page.evaluate(()=>{window.originalBitmap=createImageBitmap;window.releases=[];window.createImageBitmap=(...args)=>new Promise((resolve,reject)=>window.releases.push(()=>window.originalBitmap(...args).then(resolve,reject)));});
  await page.locator('#asset-file').setInputFiles({name:'delayed.png',mimeType:'image/png',buffer:png(16,12)});await expect(page.locator('#asset-status')).toContainText('確認しています');await expect(page.locator('#save-project')).toBeDisabled();await expect(page.locator('#open-project')).toBeDisabled();await expect(page.locator('#parts-template')).toBeDisabled();await page.locator('#reset').click();
  await page.evaluate(()=>{window.createImageBitmap=window.originalBitmap;window.releases.splice(0).forEach(f=>f());});await page.waitForTimeout(100);await expect(page.locator('.asset-panel')).toBeHidden();await expect(page.locator('#asset-inventory')).toContainText('0 / 15');
  await page.locator('#file').setInputFiles({name:'again.png',mimeType:'image/png',buffer:png()});await expect(page.locator('#source-preview')).toBeVisible();await asset(page);
  await page.evaluate(()=>{window.createImageBitmap=(...args)=>new Promise((resolve,reject)=>window.releases.push(()=>window.originalBitmap(...args).then(resolve,reject)));});await page.locator('#asset-file').setInputFiles({name:'delayed.png',mimeType:'image/png',buffer:png(16,12)});await expect(page.locator('#asset-status')).toContainText('確認しています');
  // Restore normal decoding for a new source while releasing the older asset request afterwards.
  await page.evaluate(()=>{window.createImageBitmap=window.originalBitmap;});await page.locator('#file').setInputFiles({name:'next.png',mimeType:'image/png',buffer:png()});await expect(page.locator('#file-info')).toContainText('next.png');await page.evaluate(()=>window.releases.splice(0).forEach(f=>f()));await page.waitForTimeout(100);await expect(page.locator('#asset-inventory')).toContainText('0 / 15');await expect(page.locator('#asset-download')).toBeDisabled();
});

test('project limits count supplementary images before reading their bytes',async({page})=>{
  await setup(page);const encoded=png(16,12).toString('base64');const messages=await page.evaluate(async encoded=>{
    const {createProjectFile}=await import('/src/project-file.js'),{EXPRESSION_ROLE_IDS}=await import('/src/expression-assets.js');
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),file=new File([bytes],'source.png',{type:'image/png'}),messages=[];
    for(const [count,size] of [[1,10*1024*1024+1],[11,10*1024*1024]]) {
      const blob=new Blob([new Uint8Array(size)],{type:'image/png'});blob.arrayBuffer=()=>{throw new Error('Image bytes must not be read when over budget');};
      const expressions=EXPRESSION_ROLE_IDS.slice(0,count).map(role=>({role,name:'image.png',width:16,height:12,placement:{x:0,y:0,width:1,height:1},blob}));
      try{await createProjectFile({file,mode:'demo',selected:['hair'],prompts:{},results:[],expressions});messages.push('unexpected success');}catch(e){messages.push(e.message);}
    }
    return messages;
  },encoded);for(const message of messages){expect(message).toContain('100 MiB');expect(message).toContain('各表情素材 10 MiB');}
});

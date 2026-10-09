import {test,expect} from '@playwright/test';
import {encode} from 'fast-png';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

function png(id='source',w=120,h=180) {
  const data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const visible=id==='source' || (id==='hair'?x>35&&x<75&&y>15&&y<100:x>25&&x<85&&y>80&&y<160);
    if(visible){const i=(y*w+x)*4;data.set(id==='hair'?[220,60,80,255]:[40,110,200,255],i);}
  }
  return Buffer.from(encode({width:w,height:h,data,channels:4,depth:8}));
}
async function download(page,selector) {
  const event=page.waitForEvent('download');await page.locator(selector).click();const d=await event,chunks=[];
  for await(const chunk of await d.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);
}
async function setup(page) {
  await page.goto('/');await page.locator('#file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png()});await expect(page.locator('#source-preview')).toBeVisible();
  await expect(page.locator('#motion-play')).toBeDisabled();await page.locator('#processing-mode').selectOption('ai');
  for(const id of ['face','eyes'])await page.locator(`.part-options input[value=${id}]`).uncheck();
  await page.locator('#edit-prompts').click();await page.getByText('数値で指定（キーボード操作）').click();
  for(const id of ['hair','body']){await page.locator('#prompt-part').selectOption(id);await page.locator('#coordinate-form input[name=x]').fill('50');await page.locator('#coordinate-form input[name=y]').fill('50');await page.getByRole('button',{name:'数値を反映'}).click();}
  await page.locator('#close-prompts').click();
  await page.route('**/api/separate',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({parts:['hair','body'].map(id=>({id,png:png(id).toString('base64')}))})}));
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(2);await expect(page.locator('#motion-play')).toBeEnabled();
}
const pixels=page=>page.locator('#motion-canvas').evaluate(c=>c.toDataURL());

test('motion preview changes visible pixels, stops, respects selection and keeps exported PNG unchanged',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);const before=await pixels(page);
  const overlap=()=>page.locator('#motion-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(50,90,1,1).data));
  expect(await overlap()).toEqual([220,60,80,255]);await page.locator('#motion-order').fill('0');await page.locator('#motion-apply').click();expect(await overlap()).toEqual([40,110,200,255]);await page.locator('#motion-order').fill('2');await page.locator('#motion-apply').click();
  await page.locator('#motion-tilt').fill('12');expect(await pixels(page)).not.toBe(before);
  await page.locator('#motion-play').click();await expect(page.locator('#motion-play')).toHaveText('再生を停止');const frame=await pixels(page);await expect.poll(()=>pixels(page)).not.toBe(frame);
  await page.locator('#motion-play').click();const stopped=await pixels(page);await page.waitForTimeout(150);expect(await pixels(page)).toBe(stopped);
  expect(await download(page,'[data-part=hair] a')).toEqual(png('hair'));
  await page.locator('.part-options input[value=hair]').uncheck();await expect(page.locator('#motion-status')).toContainText('1 パーツ');await expect(page.locator('#motion-part option')).toHaveCount(1);
  await page.locator('.part-options input[value=body]').uncheck();await expect(page.locator('#motion-play')).toBeDisabled();await expect(page.locator('#motion-status')).toContainText('選択中のAI結果が必要');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('motion project round trip, strict invalid settings rejection, and older projects retain compatibility',async({page})=>{
  await setup(page);await page.locator('#motion-part').selectOption('hair');await page.locator('#motion-x').fill('37.5');await page.locator('#motion-y').fill('28.2');await page.locator('#motion-order').fill('88');await page.locator('#motion-swing').fill('7.5');await page.locator('#motion-head').uncheck();await page.locator('#motion-apply').click();
  const saved=await download(page,'#save-project'),entries=unzipSync(saved),manifest=JSON.parse(strFromU8(entries['project.json']));
  expect(manifest.version).toBe(4);expect(manifest.motion.hair).toEqual({x:.375,y:.282,order:88,swing:7.5,head:false});
  await page.locator('#reset').click();await page.locator('#project-file').setInputFiles({name:'work.zip',mimeType:'application/zip',buffer:saved});await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#motion-play')).toBeEnabled();await expect(page.locator('#motion-play')).toHaveText('揺れ・呼吸を再生');await expect(page.locator('#motion-x')).toHaveValue('37.5');await expect(page.locator('#motion-order')).toHaveValue('88');
  const url=await page.locator('[data-part=hair] img').getAttribute('src');
  for(const bad of [{...manifest.motion.hair,x:1.1},{...manifest.motion.hair,swing:'7'},{...manifest.motion.hair,order:-1},{...manifest.motion.hair,unknown:1}]) {
    const broken={...entries,'project.json':strToU8(JSON.stringify({...manifest,motion:{hair:bad}}))};await page.locator('#project-file').setInputFiles({name:'invalid.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(broken,{level:0}))});await expect(page.locator('#project-status')).toContainText('読み込みに失敗');expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(url);await expect(page.locator('#motion-x')).toHaveValue('37.5');
  }
  for(const version of [1,2,3]) {
    const old={...manifest,version};delete old.motion;if(version<3)delete old.reviews;if(version===1){delete old.template;delete old.templates;}
    await page.locator('#project-file').setInputFiles({name:'old.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({...entries,'project.json':strToU8(JSON.stringify(old))},{level:0}))});await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#motion-play')).toBeEnabled();await expect(page.locator('#motion-x')).toHaveValue('50');
  }
});

test('late bitmap decoding after reset does not restore a removed character',async({page})=>{
  await setup(page);await page.locator('.part-options input[value=hair]').uncheck();await expect(page.locator('#motion-play')).toBeEnabled();
  await page.evaluate(()=>{const original=createImageBitmap;window.pendingDecodes=[];window.createImageBitmap=(...args)=>new Promise((resolve,reject)=>{window.pendingDecodes.push(()=>original(...args).then(resolve,reject));});});
  await page.locator('.part-options input[value=hair]').check();await expect(page.locator('#motion-status')).toContainText('準備');await page.locator('#reset').click();
  await page.evaluate(()=>window.pendingDecodes.splice(0).forEach(release=>release()));await page.waitForTimeout(150);await expect(page.locator('.motion-panel')).toBeHidden();await expect(page.locator('#motion-play')).toBeDisabled();expect(await page.locator('#motion-canvas').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v))).toBe(false);
  expect(await page.evaluate(()=>window.pendingDecodes.length)).toBe(0);
});

test('wrong-size AI masks cannot be previewed and preserve editable source and results',async({page})=>{
  await setup(page);await page.route('**/api/separate',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({parts:['hair','body'].map(id=>({id,png:png(id,40,40).toString('base64')}))})}));
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(2);await expect(page.locator('#motion-status')).toContainText('元画像と同じサイズ');await expect(page.locator('#motion-play')).toBeDisabled();await expect(page.locator('#source-preview')).toBeVisible();await expect(page.locator('#edit-prompts')).toBeEnabled();expect(await download(page,'[data-part=hair] a')).toEqual(png('hair',40,40));
});

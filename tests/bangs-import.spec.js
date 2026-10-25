import {test,expect} from '@playwright/test';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
test.use({hasTouch:true,isMobile:true});
const json=(z,n)=>JSON.parse(strFromU8(z[n]));
async function ready(page){await expect(page.locator('#character-maker-mode')).toHaveAttribute('aria-busy','false');}
async function setup(page){await page.goto('/');await page.locator('#maker-create').click();await expect(page.locator('#maker-status')).toContainText('33パーツを組み立てました',{timeout:30000});await ready(page);await page.locator('#maker-bangs-import summary').click();}
async function download(page,id='#maker-save'){const event=page.waitForEvent('download');await page.locator(id).click();const d=await event,chunks=[];for await(const b of await d.createReadStream())chunks.push(b);await ready(page);return Buffer.concat(chunks);}
async function source(page,kind='template'){
  // Own local SVG template only, for CI mechanics. Real owner PNG is required
  // and separately exercised by real-bangs-trial.mjs; no AI quality claim here.
  const data=await page.evaluate(async kind=>{const {generateDesignedCharacter}=await import('/src/character-generation/design-generator.js');const c=document.createElement('canvas');c.width=960;c.height=680;const ctx=c.getContext('2d');if(kind==='opaque'){ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);}else{const p=await generateDesignedCharacter(),im=await createImageBitmap(p.assets.get('bangs_front'));ctx.drawImage(im,82,80,im.width*2,im.height*2);im.close();}return c.toDataURL().split(',')[1];},kind);
  return {name:'生成した前髪.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}
async function attach(page,file){await page.locator('#maker-bangs-file').setInputFiles(file);await page.locator('#maker-bangs-apply').click();await expect(page.locator('#maker-status')).toContainText('装着しました',{timeout:30000});await ready(page);}
test('automatic import extends only front-hair geometry, preserves the other 32 PNGs, undo/reset and v2 save/reopen',async({page})=>{
  test.setTimeout(90000);await setup(page);const before=unzipSync(await download(page)),file=await source(page);const fingerprint=await page.locator('#maker-canvas').evaluate(c=>c.toDataURL());await page.locator('#maker-bangs-file').setInputFiles(file);expect(await page.locator('#maker-canvas').evaluate(c=>c.toDataURL())).toBe(fingerprint);
  await page.locator('#maker-HeadTilt').fill('0.5');await attach(page,file);await expect(page.locator('#maker-HeadTilt')).toHaveValue('0.5');const bytes=await download(page),z=unzipSync(bytes),m=json(z,'maker_project.json');expect(m.version).toBe(2);expect(m.assembly_extension.role).toBe('bangs_front');
  for(const p of m.parts)if(p.role!=='bangs_front')expect(Buffer.from(z[p.file]).equals(Buffer.from(before[p.file]))).toBe(true);
  expect(json(z,'inochi_model.json').param).toEqual(json(before,'inochi_model.json').param);
  await page.locator('#maker-undo').click();await ready(page);expect(Buffer.from(unzipSync(await download(page))['character.inp']).equals(Buffer.from(before['character.inp']))).toBe(true);
  await page.reload();await page.locator('#maker-open-file').setInputFiles({name:'new.zip',mimeType:'application/zip',buffer:bytes});await page.locator('#maker-open').click();await expect(page.locator('#maker-status')).toContainText('再開しました');await ready(page);expect((await download(page)).equals(bytes)).toBe(true);
  await page.locator('#maker-restore').click();await ready(page);const reset=unzipSync(await download(page));expect(json(reset,'maker_project.json').version).toBe(1);expect(Buffer.from(reset['character.inp']).equals(Buffer.from(before['character.inp']))).toBe(true);
});
test('invalid source, cancelled placement, corrupted placement and malformed stored numbers keep previous project',async({page})=>{
  test.setTimeout(90000);await setup(page);const baseline=unzipSync(await download(page));await page.locator('#maker-bangs-file').setInputFiles(await source(page,'opaque'));await page.locator('#maker-bangs-apply').click();await expect(page.locator('#maker-status')).toContainText('保持しています');await ready(page);expect(Buffer.from(unzipSync(await download(page))['character.inp']).equals(Buffer.from(baseline['character.inp']))).toBe(true);
  const valid=await source(page);await page.locator('#maker-bangs-file').setInputFiles(valid);await page.locator('#maker-bangs-apply').click();await page.locator('#maker-cancel').click();await expect(page.locator('#maker-status')).toContainText('中止');await ready(page);await attach(page,valid);const good=unzipSync(await download(page));
  for(const kind of ['rectangle','preparation']){const z={...good},m=json(z,'maker_project.json');if(kind==='rectangle')m.assembly_extension.rect.y=0;else m.parts.find(p=>p.role==='bangs_front').origin.import_preparation.placement.scale='untrusted';z['maker_project.json']=strToU8(JSON.stringify(m));await page.locator('#maker-open-file').setInputFiles({name:'bad.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(z))});await page.locator('#maker-open').click();await expect(page.locator('#maker-status')).toContainText('保持しています');await ready(page);expect(Buffer.from(unzipSync(await download(page))['character.inp']).equals(Buffer.from(good['character.inp']))).toBe(true);}
});
test('comparison ZIP contains actual paired renders and original source with accurate non-official flags',async({page})=>{
  test.setTimeout(90000);await setup(page);const file=await source(page);await attach(page,file);const z=unzipSync(await download(page,'#maker-bangs-review')),report=json(z,'import_report.json');expect(Buffer.from(z['source_original.png']).equals(file.buffer)).toBe(true);expect(report.poses).toHaveLength(12);expect(report.original_source_included).toBe(true);expect(report.official_creator_tested_by_this_export).toBe(false);expect(report.appearance_quality_passed).toBe(false);expect(z['side_by_side.png']).toBeTruthy();expect(Object.keys(z).filter(n=>n.startsWith('motion/'))).toHaveLength(12);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

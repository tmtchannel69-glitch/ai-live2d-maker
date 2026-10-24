import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';

test.use({hasTouch:true,isMobile:true});
async function getDownload(page,selector){
  const wait=page.waitForEvent('download');
  await page.locator(selector).click();
  const download=await wait,parts=[];
  for await(const chunk of await download.createReadStream())parts.push(chunk);
  return Buffer.concat(parts);
}
async function setup(page){
  await page.goto('/');
  await page.locator('#mode-generate').click();
  await page.locator('#cg-provider').selectOption('design-local');
  await page.locator('#cg-generate').click();
  await expect(page.locator('#cg-status')).toContainText('INP/INX',{timeout:90000});
  await expect(page.locator('#cg-external-import')).toBeVisible();
  await expect(page.locator('#cg-ex-role')).toHaveValue('iris_l');
}
async function canvasPng(page,mode){
  const b64=await page.evaluate(async mode=>{
    const canvas=document.createElement('canvas');
    canvas.width=mode==='in-bounds'?62:768;
    canvas.height=mode==='in-bounds'?74:1024;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#8065bd';
    if(mode==='in-bounds')ctx.fillRect(15,17,22,30);
    else{ctx.fillRect(0,0,10,10);ctx.fillRect(451,340,10,10);}
    return canvas.toDataURL('image/png').split(',')[1];
  },mode);
  return Buffer.from(b64,'base64');
}
test('import one transparent cropped PNG, build a separate model and keep canonical ZIP unchanged',async({page})=>{
  await setup(page);
  const original=await getDownload(page,'#cg-download-zip');
  const png=await canvasPng(page,'in-bounds');
  await page.locator('#cg-ex-file').setInputFiles({name:'my-iris.png',mimeType:'image/png',buffer:png});
  await page.locator('#cg-ex-apply').click();
  await expect(page.locator('#cg-ex-status')).toContainText('実験用モデルを作成しました',{timeout:90000});
  await expect(page.locator('#cg-ex-results')).toBeVisible();
  const experimental=unzipSync(await getDownload(page,'#cg-ex-download'));
  expect(Object.keys(experimental).sort()).toEqual([
    'README.txt','character.inp','character.inx','experimental_import_report.json','parts/iris_l.png','preview.png'
  ].sort());
  const report=JSON.parse(strFromU8(experimental['experimental_import_report.json']));
  expect(report).toMatchObject({role:'iris_l',replacement_count:1,remaining_local_template_parts:32,
    ai_origin_verified:false,full_ai_character:false,inochi_model_generated:true,official_creator_tested:false});
  expect(experimental['character.inp'].byteLength).toBeGreaterThan(100);
  const unchanged=await getDownload(page,'#cg-download-zip');
  expect(unchanged.equals(original)).toBe(true);
});
test('reject full-canvas pixels outside selected role without replacing original',async({page})=>{
  await setup(page);
  const png=await canvasPng(page,'out-of-bounds');
  await page.locator('#cg-ex-file').setInputFiles({name:'not-a-part.png',mimeType:'image/png',buffer:png});
  await page.locator('#cg-ex-apply').click();
  await expect(page.locator('#cg-ex-status')).toContainText('指定パーツの範囲外');
  await expect(page.locator('#cg-ex-results')).toBeHidden();
  await expect(page.locator('#cg-summary')).toContainText('AI生成ではありません');
});

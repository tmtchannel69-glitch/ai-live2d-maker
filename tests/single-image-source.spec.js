import {test,expect} from '@playwright/test';
import {encode,decode} from 'fast-png';
import {unzipSync,strFromU8} from 'fflate';
test.use({hasTouch:true,isMobile:true});

const portrait=(w=200,h=300)=>{
  const data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4;
    data[p]=180;data[p+1]=140;data[p+2]=220;data[p+3]=255;
  }
  return Buffer.from(encode({width:w,height:h,data,channels:4,depth:8}));
};
async function setup(page){
  await page.goto('/');await page.locator('#mode-generate').click();
  await expect(page.locator('#cg-single-portrait')).toBeVisible();
}
async function download(page,id){
  const event=page.waitForEvent('download');
  await page.locator(id).click();
  const d=await event,buffer=[];
  for await(const piece of await d.createReadStream())buffer.push(piece);
  return Buffer.concat(buffer);
}
test('one PNG goes through honest source audit and exports reference without fake layers',async({page})=>{
  await setup(page);
  let apiCalls=0;
  await page.route('**/api/**',route=>{apiCalls++;return route.abort();});
  await page.locator('#cg-single-file').setInputFiles({
    name:'portrait.png',mimeType:'image/png',buffer:portrait()
  });
  await expect(page.locator('#cg-single-status')).toContainText('入力画像の検査が完了',{timeout:25000});
  await expect(page.locator('#cg-single-result')).toBeVisible();
  await expect(page.locator('#cg-single-role option')).toHaveCount(33);
  await page.locator('#cg-single-role').selectOption('iris_l');
  await expect(page.locator('#cg-single-summary')).toContainText('分離済みパーツ 0枚');
  const entries=unzipSync(await download(page,'#cg-single-download'));
  expect(Object.keys(entries).sort()).toEqual(['README.txt','normalized_reference.png','source_audit.json']);
  const report=JSON.parse(strFromU8(entries['source_audit.json']));
  expect(report).toMatchObject({
    format:'ai-live2d-single-portrait-audit',version:1,canvas_size:[768,1024],
    roles_checked:33,independent_parts_generated:0,hidden_surfaces_recovered:0,
    automatic_segmentation_performed:false,rigging_performed:false,ai_generation_performed:false,
    subject_landmarks_detected:false,appearance_quality_verified:false
  });
  expect(report.role_windows).toHaveLength(33);
  expect(report.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(report.normalization.draw_rect).toEqual({x:42,y:0,width:683,height:1024});
  expect(entries['normalized_reference.png'].byteLength).toBeGreaterThan(1000);
  expect(apiCalls).toBe(0);
});
test('input rejects unsupported or corrupt image without stale output',async({page})=>{
  await setup(page);
  await page.locator('#cg-single-file').setInputFiles({
    name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('not a picture')
  });
  await expect(page.locator('#cg-single-status')).toContainText('画像を確認できませんでした');
  await expect(page.locator('#cg-single-result')).toBeHidden();
  await page.locator('#cg-single-file').setInputFiles({
    name:'fake.png',mimeType:'image/png',buffer:Buffer.from('not really a png')
  });
  await expect(page.locator('#cg-single-status')).toContainText('画像を確認できませんでした');
  await expect(page.locator('#cg-single-result')).toBeHidden();
});
test('no template character needs to be generated before one portrait audit',async({page})=>{
  await setup(page);
  await expect(page.locator('#cg-output')).toBeHidden();
  await page.locator('#cg-single-file').setInputFiles({
    name:'reference.png',mimeType:'image/png',buffer:portrait(300,200)
  });
  await expect(page.locator('#cg-single-status')).toContainText('検査が完了');
  await expect(page.locator('#cg-output')).toBeHidden();
  await expect(page.locator('#cg-single-summary')).toContainText('モデル生成なし');
});
function coloredPortrait({transparent=false,uniform=false,halfTransparent=false}={}){
  const w=200,h=300,data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const pos=(y*w+x)*4;
    const inside=!uniform&&x>=50&&x<150&&y>=60&&y<240;
    const color=inside?[70,65,175,halfTransparent?128:255]:[255,255,255,transparent?0:255];
    data.set(color,pos);
  }
  return Buffer.from(encode({width:w,height:h,data,channels:4,depth:8}));
}
test('single flat-background portrait yields a mask and real RGBA cutout, not 33 layers',async({page})=>{
  await setup(page);
  await page.locator('#cg-single-file').setInputFiles({
    name:'single-flat.png',mimeType:'image/png',buffer:coloredPortrait()
  });
  await expect(page.locator('#cg-single-status')).toContainText('検査が完了');
  await page.locator('#cg-single-make-mask').click();
  await expect(page.locator('#cg-single-mask-output')).toBeVisible({timeout:30000});
  await expect(page.locator('#cg-single-mask-summary')).toContainText('分離済みの人体パーツ 0枚');
  const archive=unzipSync(await download(page,'#cg-single-download'));
  expect(Object.keys(archive).sort()).toEqual([
    'README.txt','foreground_cutout.png','foreground_mask.png','normalized_reference.png','source_audit.json'
  ].sort());
  const report=JSON.parse(strFromU8(archive['source_audit.json']));
  expect(report.foreground_mask_result).toMatchObject({
    method:'flat-background-flood',foreground_mask_generated:true,
    independent_parts_generated:0,anatomical_segmentation_performed:false,
    hidden_surfaces_recovered:0,rigging_performed:false,ai_generation_performed:false
  });
  const cutout=decode(archive['foreground_cutout.png']);
  const mask=decode(archive['foreground_mask.png']);
  expect([cutout.width,cutout.height,cutout.channels]).toEqual([768,1024,4]);
  expect([mask.width,mask.height,mask.channels]).toEqual([768,1024,4]);
  expect(cutout.data[(100*768+100)*4+3]).toBe(0);
  expect(cutout.data[(500*768+380)*4+3]).toBe(255);
  expect(mask.data[(100*768+100)*4+3]).toBe(0);
  expect(mask.data[(500*768+380)*4+3]).toBe(255);
});
test('transparent source uses alpha and rejects ambiguous uniform background without fake output',async({page})=>{
  await setup(page);
  await page.locator('#cg-single-file').setInputFiles({
    name:'transparent.png',mimeType:'image/png',buffer:coloredPortrait({transparent:true,halfTransparent:true})
  });
  await expect(page.locator('#cg-single-status')).toContainText('検査が完了');
  await page.locator('#cg-single-make-mask').click();
  await expect(page.locator('#cg-single-mask-output')).toBeVisible({timeout:30000});
  const archive=unzipSync(await download(page,'#cg-single-download'));
  const report=JSON.parse(strFromU8(archive['source_audit.json']));
  expect(report.foreground_mask_result.method).toBe('existing-alpha');
  const reference=decode(archive['normalized_reference.png']);
  const cutout=decode(archive['foreground_cutout.png']);
  const center=(500*768+380)*4+3;
  expect(reference.data[center]).toBe(128);
  expect(cutout.data[center]).toBe(reference.data[center]);
  await page.locator('#cg-single-file').setInputFiles({
    name:'uniform.png',mimeType:'image/png',buffer:coloredPortrait({uniform:true})
  });
  await expect(page.locator('#cg-single-status')).toContainText('検査が完了');
  await page.locator('#cg-single-make-mask').click();
  await expect(page.locator('#cg-single-status')).toContainText('安全に前景を切り出せませんでした');
  await expect(page.locator('#cg-single-mask-output')).toBeHidden();
  const clean=unzipSync(await download(page,'#cg-single-download'));
  expect(Object.keys(clean).sort()).toEqual(['README.txt','normalized_reference.png','source_audit.json']);
});
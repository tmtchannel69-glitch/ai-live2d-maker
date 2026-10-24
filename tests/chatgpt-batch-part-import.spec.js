import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import {decode} from 'fast-png';
test.use({hasTouch:true,isMobile:true});
async function download(page,selector){
  const event=page.waitForEvent('download');
  await page.locator(selector).click();
  const file=await event,chunks=[];
  for await(const chunk of await file.createReadStream())chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function setup(page){
  await page.goto('/');await page.locator('#mode-generate').click();
  await page.locator('#cg-provider').selectOption('design-local');
  await page.locator('#cg-generate').click();
  await expect(page.locator('#cg-status')).toContainText('INP/INX',{timeout:90000});
  await expect(page.locator('#cg-batch-import')).toBeVisible();
}
async function imageForRole(page,role,{outside=false}={}){
  const base64=await page.evaluate(async({role,outside})=>{
    const {createDesignPlan}=await import('/shared/character-design.js');
    const plan=await createDesignPlan(),part=plan.blueprint.parts.find(p=>p.role===role);
    const c=document.createElement('canvas');
    c.width=outside?768:part.rect.width;
    c.height=outside?1024:part.rect.height;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#8065bd';
    if(outside)ctx.fillRect(0,0,12,12);
    else ctx.fillRect(Math.floor(c.width*.28),Math.floor(c.height*.25),Math.max(2,Math.floor(c.width*.35)),Math.max(2,Math.floor(c.height*.4)));
    return c.toDataURL('image/png').split(',')[1];
  },{role,outside});
  return {name:role+'.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')};
}
test('two external parts create an isolated model and full reproducible 33-texture ZIP',async({page})=>{
  await setup(page);
  let requests=0;await page.route('**/api/**',route=>{requests++;return route.abort();});
  const original=await download(page,'#cg-download-zip');
  const parts=[await imageForRole(page,'iris_l'),await imageForRole(page,'iris_r')];
  await page.locator('#cg-batch-files').setInputFiles(parts);
  await expect(page.locator('#cg-batch-selection')).toContainText('2枚を検出');
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('一括取り込みを完了',{timeout:90000});
  const zipped=unzipSync(await download(page,'#cg-batch-download'));
  const report=JSON.parse(strFromU8(zipped['experimental_batch_report.json']));
  const manifest=JSON.parse(strFromU8(zipped['character_manifest.json']));
  expect(report).toMatchObject({external_part_count:2,local_template_part_count:31,model_build_invocations:1,
    ai_origin_verified:false,fully_ai_generated:false,official_creator_tested:false,no_network_transmission:true});
  expect(report.quality_warning_count).toBe(0);
  expect(report.parts).toHaveLength(2);
  expect(report.parts.every(p=>p.pixel_diagnostics.appearance_quality_verified===false)).toBe(true);
  expect(report.provided_roles).toEqual(['iris_r','iris_l'].sort((a,b)=>manifest.parts.findIndex(p=>p.role===a)-manifest.parts.findIndex(p=>p.role===b)));
  expect(manifest.parts).toHaveLength(33);
  expect(zipped['character.inp'].length).toBeGreaterThan(100);
  expect(zipped['character.inx'].length).toBeGreaterThan(100);
  expect(Object.keys(zipped)).toHaveLength(40);
  for(const part of manifest.parts){
    const png=decode(zipped[part.file]);
    expect([png.width,png.height,png.channels,png.depth]).toEqual([part.rect.width,part.rect.height,4,8]);
  }
  expect(await download(page,'#cg-download-zip')).toEqual(original);
  expect(requests).toBe(0);
});
test('duplicate filenames and unknown parts are rejected without substituting a template',async({page})=>{
  await setup(page);
  const part=await imageForRole(page,'iris_l');
  await page.locator('#cg-batch-files').setInputFiles([part,part]);
  await expect(page.locator('#cg-batch-selection')).toContainText('重複');
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('重複');
  await expect(page.locator('#cg-batch-output')).toBeHidden();
  await page.locator('#cg-batch-files').setInputFiles([{...part,name:'invented.png'}]);
  await expect(page.locator('#cg-batch-selection')).toContainText('未対応');
});
test('full-size image with pixels outside its role is rejected without changing previous character',async({page})=>{
  await setup(page);
  const part=await imageForRole(page,'iris_l',{outside:true});
  await page.locator('#cg-batch-files').setInputFiles([part]);
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('指定範囲外',{timeout:30000});
  await expect(page.locator('#cg-batch-output')).toBeHidden();
  await expect(page.locator('#cg-summary')).toContainText('AI生成ではありません');
});
test('single visible pixel prompts quality review but never claims AI quality',async({page})=>{
  await setup(page);
  const b64=await page.evaluate(async()=>{
    const {createDesignPlan}=await import('/shared/character-design.js');
    const part=(await createDesignPlan()).blueprint.parts.find(p=>p.role==='iris_l');
    const canvas=document.createElement('canvas');canvas.width=part.rect.width;canvas.height=part.rect.height;
    canvas.getContext('2d').fillRect(Math.floor(part.rect.width/2),Math.floor(part.rect.height/2),1,1);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#cg-batch-files').setInputFiles([{
    name:'iris_l.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')
  }]);
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('一括取り込みを完了',{timeout:90000});
  await expect(page.locator('#cg-batch-warnings')).toContainText('描画範囲が極端に小さい');
  const report=JSON.parse(strFromU8(unzipSync(await download(page,'#cg-batch-download'))['experimental_batch_report.json']));
  expect(report.quality_warning_count).toBeGreaterThan(0);
  expect(report.quality_warnings).toContainEqual({role:'iris_l',code:'very-low-coverage'});
  expect(report.human_visual_review_completed).toBe(false);
  expect(report.appearance_quality_passed).toBe(false);
});

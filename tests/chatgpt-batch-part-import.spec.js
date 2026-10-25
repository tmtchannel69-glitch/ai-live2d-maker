import {test,expect} from '@playwright/test';
import {unzipSync,zipSync,strFromU8} from 'fflate';
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
test('compares template and user PNG for each imported role without altering canonical results',async({page})=>{
  await setup(page);
  const original=await download(page,'#cg-download-zip');
  const selections=[await imageForRole(page,'iris_l'),await imageForRole(page,'iris_r')];
  await page.locator('#cg-batch-files').setInputFiles(selections);
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('一括取り込みを完了',{timeout:90000});
  const selector=page.locator('#cg-batch-review-role');
  await expect(selector.locator('option')).toHaveCount(2);
  await selector.selectOption('iris_l');
  await expect(page.locator('#cg-batch-review-info')).toContainText('iris_l');
  const first=await page.locator('#cg-batch-replacement').getAttribute('src');
  await expect(page.locator('#cg-batch-original')).toHaveAttribute('src',/^blob:/);
  await expect(page.locator('#cg-batch-replacement')).toHaveAttribute('src',/^blob:/);
  await selector.selectOption('iris_r');
  await expect(page.locator('#cg-batch-review-info')).toContainText('iris_r');
  const second=await page.locator('#cg-batch-replacement').getAttribute('src');
  expect(first).not.toBe(second);
  expect(await download(page,'#cg-download-zip')).toEqual(original);
});
test('all 33 supplied PNGs replace templates and export a complete local-only model',async({page})=>{
  test.setTimeout(180000);
  await setup(page);
  let apiCalls=0;
  await page.route('**/api/**',route=>{apiCalls++;return route.abort();});
  const originals=await download(page,'#cg-download-zip');
  // Use known-valid per-role layer shapes from the canonical archive;
  // arbitrary rectangles are intentionally rejected by anatomical rig checks.
  const canonical=unzipSync(originals);
  const originalManifest=JSON.parse(strFromU8(canonical['character_manifest.json']));
  expect(originalManifest.parts).toHaveLength(33);
  const changedIris=await imageForRole(page,'iris_l');
  const uploads=originalManifest.parts.map(part=>{
    if(part.role==='iris_l')return changedIris;
    expect(canonical[part.file]).toBeTruthy();
    return {name:part.role+'.png',mimeType:'image/png',buffer:Buffer.from(canonical[part.file])};
  });
  await page.locator('#cg-batch-files').setInputFiles(uploads);
  await expect(page.locator('#cg-batch-selection')).toContainText('33枚を検出');
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('一括取り込みを完了',{timeout:120000});
  const files=unzipSync(await download(page,'#cg-batch-download'));
  const report=JSON.parse(strFromU8(files['experimental_batch_report.json']));
  const manifest=JSON.parse(strFromU8(files['character_manifest.json']));
  expect(report).toMatchObject({external_part_count:33,local_template_part_count:0,
    model_build_invocations:1,all_33_texture_slots_present:true,ai_origin_verified:false,
    fully_ai_generated:false,official_creator_tested:false,no_network_transmission:true});
  expect(report.local_template_roles).toEqual([]);
  expect(report.parts).toHaveLength(33);
  expect(new Set(report.provided_roles).size).toBe(33);
  expect(report.parts.every(p=>/^[a-f0-9]{64}$/.test(p.source_sha256)&&p.manual_review_required)).toBe(true);
  expect(manifest.parts).toHaveLength(33);
  expect(files['character.inp'].length).toBeGreaterThan(100);
  expect(files['character.inx'].length).toBeGreaterThan(100);
  const irisRole=manifest.parts.find(p=>p.role==='iris_l');
  expect(Buffer.from(files[irisRole.file]).equals(Buffer.from(canonical[irisRole.file]))).toBe(false);

  for(const p of manifest.parts){
    const png=decode(files[p.file]);
    expect([png.width,png.height,png.channels,png.depth]).toEqual([p.rect.width,p.rect.height,4,8]);
  }
  expect(await download(page,'#cg-download-zip')).toEqual(originals);
  expect(apiCalls).toBe(0);
});

test('one invalid PNG among valid selections aborts atomically without changing the original ZIP',async({page})=>{
  await setup(page);
  const original=await download(page,'#cg-download-zip');
  const good=await imageForRole(page,'iris_r');
  const invalid=await imageForRole(page,'iris_l',{outside:true});
  await page.locator('#cg-batch-files').setInputFiles([good,invalid]);
  await expect(page.locator('#cg-batch-selection')).toContainText('2枚を検出');
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('指定範囲外',{timeout:30000});
  await expect(page.locator('#cg-batch-output')).toBeHidden();
  await expect(page.locator('#cg-batch-review-role').locator('option')).toHaveCount(0);
  expect(await download(page,'#cg-download-zip')).toEqual(original);
});
test('complete character ZIP restores 33 roles locally without touching canonical output',async({page})=>{
  test.setTimeout(180000);
  await setup(page);
  const original=await download(page,'#cg-download-zip');
  await page.locator('#cg-batch-zip').setInputFiles({name:'all-33-parts.zip',mimeType:'application/zip',buffer:original});
  await expect(page.locator('#cg-batch-selection')).toContainText('PNG 33枚を検出',{timeout:30000});
  await page.locator('#cg-batch-apply').click();
  await expect(page.locator('#cg-batch-status')).toContainText('一括取り込みを完了',{timeout:120000});
  const out=unzipSync(await download(page,'#cg-batch-download'));
  const report=JSON.parse(strFromU8(out['experimental_batch_report.json']));
  expect(report).toMatchObject({external_part_count:33,local_template_part_count:0,
    input_bundle_kind:'local-zip',model_build_invocations:1,fully_ai_generated:false,
    ai_origin_verified:false,no_network_transmission:true});
  expect(report.parts).toHaveLength(33);
  expect(await download(page,'#cg-download-zip')).toEqual(original);
});

test('reject ZIP path traversal and duplicate aliases before loading layers',async({page})=>{
  await setup(page);
  const image=await imageForRole(page,'iris_l');
  const unsafe=zipSync({'../iris_l.png':image.buffer},{level:0});
  await page.locator('#cg-batch-zip').setInputFiles({
    name:'unsafe.zip',mimeType:'application/zip',buffer:Buffer.from(unsafe)
  });
  await expect(page.locator('#cg-batch-selection')).toContainText('ZIPを取り込めません');
  await expect(page.locator('#cg-batch-selection')).toContainText('不正なパス');
  await expect(page.locator('#cg-batch-output')).toBeHidden();
  const duplicate=zipSync({'iris_l.png':image.buffer,'parts/iris_l.png':image.buffer},{level:0});
  await page.locator('#cg-batch-zip').setInputFiles({
    name:'duplicate.zip',mimeType:'application/zip',buffer:Buffer.from(duplicate)
  });
  await expect(page.locator('#cg-batch-selection')).toContainText('同じパーツが重複');
  await expect(page.locator('#cg-batch-output')).toBeHidden();
});

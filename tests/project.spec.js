import {test,expect} from '@playwright/test';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';

async function downloadBytes(page,selector) {
  const pending=page.waitForEvent('download');await page.locator(selector).click();const download=await pending;
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function upload(page) {
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='#8040c0';ctx.fillRect(0,0,200,300);return c.toDataURL().split(',')[1];});
  const previous=await page.locator('#source-preview').getAttribute('src');
  await page.locator('#file').setInputFiles({name:'character.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect.poll(()=>page.locator('#source-preview').getAttribute('src')).not.toBe(previous);await expect(page.locator('#source-preview')).toBeVisible();return png;
}
async function point(page,kind,x='25',y='30'){
  await page.locator('#prompt-kind').selectOption(kind);await page.locator('#coordinate-form input[name=x]').fill(x);await page.locator('#coordinate-form input[name=y]').fill(y);await page.getByRole('button',{name:'数値を反映'}).click();
}
async function importFile(page,bytes){await page.locator('#project-file').setInputFiles({name:'ai-live2d-work.zip',mimeType:'application/zip',buffer:bytes});}
function rewrite(bytes,change){const entries=unzipSync(bytes),metadata=JSON.parse(strFromU8(entries['project.json']));change(metadata,entries);entries['project.json']=strToU8(JSON.stringify(metadata));return Buffer.from(zipSync(entries,{level:0}));}

test('project restores corrected pixels, prompts, stale provenance and selection after reload without AI requests',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let requests=0;
  await page.goto('/');const png=await upload(page);await page.locator('#processing-mode').selectOption('ai');
  for(const id of ['body','eyes'])await page.locator(`input[value=${id}]`).uncheck();
  await page.locator('#edit-prompts').click();await page.getByText('数値で指定（キーボード操作）').click();
  await point(page,'point');await point(page,'box','10','10');await point(page,'exclude','70','70');
  await page.locator('#prompt-part').selectOption('face');await point(page,'point','50','50');await page.locator('#close-prompts').click();
  await page.route('**/api/separate',route=>{requests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({parts:(requests===1?['hair','face']:['hair']).map(id=>({id,png}))})});});
  await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(2);
  await page.getByRole('button',{name:'髪をブラシで補正',exact:true}).click();await expect(page.locator('#brush-status')).toContainText('なぞって');
  await page.getByText('数値でブラシを置く（キーボード操作）').click();await page.getByRole('button',{name:'ブラシを置く',exact:true}).click();await page.locator('#brush-apply').click();await expect(page.locator('#brush-dialog')).not.toBeVisible();
  const corrected=await downloadBytes(page,'[data-part=hair] a');
  await page.getByRole('button',{name:'髪を修正',exact:true}).click();await point(page,'point','60','60');await page.locator('#close-prompts').click();
  await page.locator('input[value=face]').uncheck();
  const project=await downloadBytes(page,'#save-project');const entries=unzipSync(project),metadata=JSON.parse(strFromU8(entries['project.json']));
  expect(Buffer.from(entries['source/image'])).toEqual(Buffer.from(png,'base64'));expect(Buffer.from(entries['parts/hair.png'])).toEqual(corrected);expect(metadata.selected).toEqual(['hair']);
  await page.reload();await expect(page.locator('.result-card')).toHaveCount(0);await importFile(page,project);await expect(page.locator('#project-status')).toContainText('作業を再開');
  expect(requests).toBe(1);await expect(page.locator('#processing-mode')).toHaveValue('ai');await expect(page.locator('#file-info')).toContainText('200 × 300');
  await expect(page.locator('input[value=hair]')).toBeChecked();await expect(page.locator('input[value=face]')).not.toBeChecked();
  await expect(page.locator('[data-part=hair] .result-state')).toContainText('以前の結果');await expect(page.locator('[data-part=hair] .result-state')).toContainText('ブラシ補正済み');
  await expect(page.locator('[data-part=face] .result-state')).not.toContainText('以前の結果');
  expect(await downloadBytes(page,'[data-part=hair] a')).toEqual(corrected);
  await page.getByRole('button',{name:'髪を修正',exact:true}).click();await expect(page.locator('#prompt-dialog svg circle')).toHaveCount(3);await expect(page.locator('#prompt-dialog svg rect')).toHaveCount(1);await expect(page.locator('#undo-prompt')).toBeDisabled();await page.locator('#close-prompts').click();
  const again=unzipSync(await downloadBytes(page,'#save-project'));expect(JSON.parse(strFromU8(again['project.json']))).toEqual(metadata);
  await page.getByRole('button',{name:'髪をブラシで補正',exact:true}).click();await expect(page.locator('#brush-status')).toContainText('なぞって');
  expect(await page.locator('#brush-canvas').evaluate(c=>c.getContext('2d').getImageData(100,150,1,1).data[3])).toBe(0);expect(errors).toEqual([]);
  await page.locator('#brush-cancel').click();const faceUrl=await page.locator('[data-part=face] img').getAttribute('src');
  await page.getByRole('button',{name:'髪を修正',exact:true}).click();await page.locator('#separate-one').click();await expect(page.locator('#prompt-run-status')).toContainText('髪だけを更新');
  await expect(page.locator('[data-part=hair] .result-state')).not.toContainText('ブラシ補正済み');
  expect(await page.locator('[data-part=face] img').getAttribute('src')).toBe(faceUrl);expect(requests).toBe(2);
});

test('unfinished project and demo results can be saved and resumed',async({page})=>{
  await page.goto('/');await upload(page);await page.locator('#processing-mode').selectOption('ai');
  await page.locator('#edit-prompts').click();await page.getByText('数値で指定（キーボード操作）').click();await point(page,'exclude');await page.locator('#close-prompts').click();
  const draft=await downloadBytes(page,'#save-project');await page.locator('#reset').click();await importFile(page,draft);await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(page.locator('#separate')).toBeDisabled();await expect(page.locator('.result-card')).toHaveCount(0);
  await page.locator('#edit-prompts').click();await expect(page.locator('#prompt-dialog svg circle')).toHaveCount(1);await page.locator('#close-prompts').click();
  await page.locator('#processing-mode').selectOption('demo');await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);
  const demo=await downloadBytes(page,'#save-project');await page.reload();await importFile(page,demo);await expect(page.locator('#project-status')).toContainText('作業を再開');
  await expect(page.locator('#processing-mode')).toHaveValue('demo');await expect(page.locator('.result-card')).toHaveCount(4);await expect(page.locator('.brush-part')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('invalid, oversized and mismatched project inputs preserve current results',async({page})=>{
  await page.goto('/');await upload(page);await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);
  const project=await downloadBytes(page,'#save-project'),source=await page.locator('#source-preview').getAttribute('src'),hair=await page.locator('[data-part=hair] img').getAttribute('src');
  const cases=[Buffer.from('not zip'),rewrite(project,m=>{m.version=99;}),rewrite(project,m=>{m.source.width=99;}),rewrite(project,m=>{m.prompts.hair={points:[{x:2,y:.5,label:1}]};}),rewrite(project,(m,e)=>{delete e['parts/hair.png'];}),rewrite(project,(m,e)=>{e['../unexpected']=strToU8('bad');}),rewrite(project,m=>{m.parts[0].id='unexpected';}),rewrite(project,(m,e)=>{e['parts/hair.png']=strToU8('broken PNG');}),rewrite(project,m=>{m.mode='ai';for(const p of m.parts)p.ai=true;}),rewrite(project,m=>{m.selected=['hair','hair'];}),rewrite(project,m=>{m.source.name='<img src=x onerror=alert(1)>/x';}),rewrite(project,m=>{m.prompts=JSON.parse('{"__proto__":{}}');})];
  for(const bytes of cases){await importFile(page,bytes);await expect(page.locator('#project-status')).toContainText('読み込みに失敗');expect(await page.locator('#source-preview').getAttribute('src')).toBe(source);expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(hair);await expect(page.locator('#save-project')).toBeEnabled();}
  const compressed=Buffer.from(zipSync(unzipSync(project),{level:6}));await importFile(page,compressed);await expect(page.locator('#project-status')).toContainText('読み込みに失敗');
  const oversize=await page.evaluate(async()=>{const {readProjectFile}=await import('/src/project-file.js');try{await readProjectFile(new File([new Uint8Array(100*1024*1024+1)],'large.zip'));return '';}catch(e){return e.message;}});expect(oversize).toContain('100 MiB');
});

test('reset discards delayed import and export failures keep the editable work',async({page})=>{
  await page.goto('/');await upload(page);const project=await downloadBytes(page,'#save-project');
  await page.evaluate(()=>{window.originalArrayBuffer=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=async function(){const data=await window.originalArrayBuffer.call(this);await new Promise(r=>setTimeout(r,300));return data;};});
  await importFile(page,project);await expect(page.locator('#project-status')).toContainText('確認しています');await page.locator('#reset').click();await page.waitForTimeout(500);
  await expect(page.locator('#source-preview')).not.toBeVisible();await expect(page.locator('#project-status')).toBeEmpty();await expect(page.locator('#open-project')).toBeEnabled();
  await page.evaluate(()=>{Blob.prototype.arrayBuffer=window.originalArrayBuffer;});await upload(page);
  const source=await page.locator('#source-preview').getAttribute('src');
  await page.evaluate(()=>{Blob.prototype.arrayBuffer=async()=>{throw new Error('simulated read failure');};});await page.locator('#save-project').click();await expect(page.locator('#project-status')).toContainText('保存に失敗');expect(await page.locator('#source-preview').getAttribute('src')).toBe(source);await expect(page.locator('#save-project')).toBeEnabled();
  await page.evaluate(()=>{Blob.prototype.arrayBuffer=window.originalArrayBuffer;});
  const downloads=[];page.on('download',d=>downloads.push(d));
  await page.evaluate(()=>{Blob.prototype.arrayBuffer=async function(){const data=await window.originalArrayBuffer.call(this);await new Promise(r=>setTimeout(r,300));return data;};});
  await page.locator('#save-project').click();await expect(page.locator('#project-status')).toContainText('準備しています');await page.locator('#reset').click();await page.waitForTimeout(500);expect(downloads).toHaveLength(0);await expect(page.locator('#open-project')).toBeEnabled();
});

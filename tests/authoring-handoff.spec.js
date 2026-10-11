import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
test.use({hasTouch:true,isMobile:true});
async function sample(page){await page.goto('/');await page.locator('#try-sample').click();await expect(page.locator('#project-status')).toContainText('サンプルを開きました');}
async function download(page,selector){const event=page.waitForEvent('download');await page.locator(selector).focus();await page.locator(selector).press('Enter');const d=await event,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);return {name:d.suggestedFilename(),bytes:Buffer.concat(chunks)};}
const json=(entries,name)=>JSON.parse(strFromU8(entries[name]));
test('handoff preserves all expression PNGs and effective motion settings without original image or model claims',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await sample(page);
  const work=unzipSync((await download(page,'#save-project')).bytes),p=json(work,'project.json');
  const output=await download(page,'#download-handoff'),entries=unzipSync(output.bytes),m=json(entries,'handoff.json');
  expect(output.name).toBe('ai-live2d-handoff.zip');expect(m).toMatchObject({format:'ai-live2d-maker-authoring-handoff',version:1,containsOriginal:false,live2dCompatible:false});expect(m.expressions).toHaveLength(11);expect(m.parts).toEqual([]);
  for(const a of m.expressions){expect(Buffer.from(entries[a.path])).toEqual(Buffer.from(work[a.path]));expect(a.placement).toEqual(p.expressions.find(x=>x.role===a.role).placement);}
  expect(m.settings.layers).toEqual(p.expressionLayers);expect(m.settings.deforms).toEqual(p.expressionDeforms);expect(m.settings.clips).toEqual(p.expressionClips);expect(m.settings.groups).toEqual(p.expressionGroups);expect(m.settings.groupKeys).toEqual(p.groupMotionKeys);expect(m.settings.clipKeys).toEqual(p.expressionClipKeys);expect(m.mesh.triangles).toHaveLength(8);
  expect(Object.keys(entries)).not.toContain('source/image');expect(Object.keys(entries)).not.toContain('project.json');expect(Object.keys(entries).some(k=>k.endsWith('.moc3'))).toBe(false);expect(strFromU8(entries['README.txt'])).toContain('直接読み込む機能はありません');expect(strFromU8(entries['MOTION_CHECKLIST.txt'])).toContain('開閉 1素材');
  await page.locator('#project-file').setInputFiles({name:'handoff.zip',mimeType:'application/zip',buffer:output.bytes});await expect(page.locator('#project-status')).toContainText('読み込みに失敗');await expect(page.locator('#scene-play')).toBeEnabled();
  await page.setViewportSize({width:320,height:640});await page.locator('[data-workflow=save]').tap();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('#download-handoff').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);expect(errors).toEqual([]);
});
test('all demo results survive template changes and remain distinguished from aligned AI parts',async({page})=>{
  await sample(page);await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);
  const raw=(await download(page,'[data-part=hair] a')).bytes;await page.locator('#parts-template').selectOption('production');await expect(page.locator('.result-card')).toHaveCount(0);
  const entries=unzipSync((await download(page,'#download-handoff')).bytes),m=json(entries,'handoff.json');expect(m.parts).toHaveLength(4);expect(m.expressions).toHaveLength(11);expect(Buffer.from(entries['parts/hair.png'])).toEqual(raw);expect(m.parts.every(p=>p.kind==='demo' && p.origin===null && p.alignment==='cropped-demo')).toBe(true);expect(strFromU8(entries['PART_CHECKLIST.txt'])).toContain('デモ・位置情報なし');
});
test('failed and cancelled exports preserve work and release processing locks',async({page})=>{
  await sample(page);await page.evaluate(()=>{window.readBytes=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=async()=>{throw new Error('simulated read error');};});await page.locator('#download-handoff').click();await expect(page.locator('#handoff-status')).toContainText('simulated read error');await expect(page.locator('#download-handoff')).toBeEnabled();await expect(page.locator('#scene-play')).toBeEnabled();
  await page.evaluate(()=>{Blob.prototype.arrayBuffer=window.readBytes;window.readImage=createImageBitmap;window.createImageBitmap=async b=>{const image=await window.readImage(b);await new Promise(r=>setTimeout(r,500));return image;};});const downloads=[];page.on('download',d=>downloads.push(d));await page.locator('#download-handoff').click();await expect(page.locator('#handoff-status')).toContainText('準備しています');await expect(page.locator('#scene-play')).toBeDisabled();await expect(page.locator('#save-project')).toBeDisabled();await page.locator('#reset').click();await expect(page.locator('#handoff-status')).toBeEmpty();await expect(page.locator('#open-project')).toBeEnabled();expect(downloads).toHaveLength(0);await expect(page.locator('#download-handoff')).toBeDisabled();
});

test('export rejects oversized images before reading them and rejects invalid settings',async({page})=>{
  await page.goto('/');const checks=await page.evaluate(async()=>{
    const {createAuthoringHandoff}=await import('/src/authoring-handoff.js');let reads=0;const blob=new Blob([new Uint8Array(10*1024*1024+1)]);blob.arrayBuffer=async()=>{reads++;throw new Error('must not read');};
    const c=document.createElement('canvas');c.width=10;c.height=10;const file=await new Promise(r=>c.toBlob(r));
    let oversized,invalid;try{await createAuthoringHandoff({file,assets:[{role:'face_base',blob}]});}catch(e){oversized=e.message;}
    try{await createAuthoringHandoff({file,groups:{transforms:{face:{dx:99}},assignments:{},clipFollow:{}}});}catch(e){invalid=e.message;}
    return {reads,oversized,invalid};
  });expect(checks.reads).toBe(0);expect(checks.oversized).toContain('上限');expect(checks.invalid).toContain('設定が正しくありません');
});

test('AI output retains source alignment and correction bytes while stale review status is downgraded',async({page})=>{
  await page.goto('/');const output=await page.evaluate(async()=>{
    const {createAuthoringHandoff}=await import('/src/authoring-handoff.js');const {promptSignature}=await import('/src/prompt-state.js');
    const c=document.createElement('canvas');c.width=100;c.height=150;c.getContext('2d').fillRect(10,20,30,40);const blob=await new Promise(r=>c.toBlob(r));
    const result={id:'eye_l',ai:true,manual:true,blob,signature:promptSignature({})};
    const archive=await createAuthoringHandoff({file:blob,results:[result],prompts:{eye_l:{positive:{x:.5,y:.5}}},reviews:{eye_l:{boundary:'checked',fill:'needed',note:'瞳と白目を分ける'}}});
    return {archive:Array.from(new Uint8Array(await archive.arrayBuffer())),raw:Array.from(new Uint8Array(await blob.arrayBuffer()))};
  });const entries=unzipSync(new Uint8Array(output.archive)),m=json(entries,'handoff.json'),part=m.parts[0];expect(part).toMatchObject({kind:'ai',alignment:'source-canvas',origin:{x:0,y:0},dimensions:{width:100,height:150},manual:true,resultMatchesPrompt:false,currentBoundary:'unchecked'});expect(part.review.boundary).toBe('checked');expect(Array.from(entries['parts/eye_l.png'])).toEqual(output.raw);expect(strFromU8(entries['PART_CHECKLIST.txt'])).toContain('変更あり・再確認が必要');expect(strFromU8(entries['PART_CHECKLIST.txt'])).toContain('瞳と白目を分ける');
});

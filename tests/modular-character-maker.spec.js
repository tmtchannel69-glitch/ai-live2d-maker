import {createHash} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {decode,encode} from 'fast-png';
import {readModularContainer} from '../shared/modular-character-rig.js';
test.use({hasTouch:true,isMobile:true});
const json=(z,p)=>JSON.parse(strFromU8(z[p]));
const bytesEqual=(a,b)=>expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
async function canvasHash(page){return createHash('sha256').update(await page.locator('#maker-canvas').evaluate(c=>c.toDataURL())).digest('hex');}
async function ready(page){await expect(page.locator('#character-maker-mode')).toHaveAttribute('aria-busy','false');}
async function setup(page){await page.goto('/');await page.locator('#maker-create').click();await expect(page.locator('#maker-status')).toContainText('33パーツを組み立てました');await ready(page);}
async function download(page,id='#maker-save'){const pending=page.waitForEvent('download');await page.locator(id).click();const file=await pending,chunks=[];for await(const c of await file.createReadStream())chunks.push(c);await ready(page);return Buffer.concat(chunks);}
async function selectPng(page,name,buffer){await page.locator('details').filter({has:page.locator('#maker-part-files')}).evaluate(e=>e.open=true);await page.locator('#maker-part-files').setInputFiles({name,mimeType:'image/png',buffer});}
async function swap(page,set){await page.locator('#maker-preset-'+set).click();await ready(page);await expect(page.locator('#maker-status')).toContainText('を交換しました');}
test('maker is the default, phone widths have usable controls, and both existing modes remain reachable',async({page})=>{
  for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.goto('/');await expect(page.locator('#character-maker-mode')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const id of ['maker-create','maker-open','maker-preset-bangs'])expect((await page.locator('#'+id).boundingBox()).height).toBeGreaterThanOrEqual(48);}
  await page.locator('#mode-convert').click();await expect(page.locator('#file')).toBeVisible();await page.locator('#mode-generate').click();await expect(page.locator('#cg-generate')).toBeVisible();await page.locator('#mode-maker').click();await expect(page.locator('#maker-create')).toBeVisible();
});
test('cumulative hair, eyes and outfit exchanges preserve pose, untouched source PNGs and seven controls, and reopen exactly',async({page})=>{
  test.setTimeout(90000);await setup(page);const base=unzipSync(await download(page));await page.locator('#maker-EyeOpenL').fill('0');await page.locator('#maker-MouthOpen').fill('0.5');await page.locator('#maker-HeadX').fill('0.25');
  for(const set of ['bangs','eyes','outfit'])await swap(page,set);
  await expect(page.locator('#maker-summary')).toContainText('交換 3回');await expect(page.locator('#maker-EyeOpenL')).toHaveValue('0');await expect(page.locator('#maker-MouthOpen')).toHaveValue('0.5');
  const current=unzipSync(await download(page)),meta=json(current,'maker_project.json');expect(meta.revision).toBe(3);expect(meta.history).toHaveLength(3);expect(meta.pose).toMatchObject({EyeOpenL:0,MouthOpen:.5,HeadX:.25});
  for(const role of ['bangs_front','eye_white_l','iris_r','dress_base','apron'])expect(Buffer.from(current['parts/'+role+'.png']).equals(Buffer.from(base['parts/'+role+'.png']))).toBe(false);
  for(const role of ['neck','face_base','mouth_inside','side_hair_r'])bytesEqual(current['parts/'+role+'.png'],base['parts/'+role+'.png']);
  for(const p of meta.parts)bytesEqual(current['base/'+p.file],base[p.file]);
  const parsed=readModularContainer(current['character.inp']);expect(parsed.model.param.map(p=>p.name)).toEqual(['EyeOpenL','EyeOpenR','MouthOpen','HeadX','HeadY','HeadTilt','Breath']);bytesEqual(current['character.inp'],current['character.inx']);
  expect(json(current,'inochi_report.json')).toMatchObject({profile:'modular-character-rig-v1',mesh_audit:{folds_detected:0},official_creator_tested:false,appearance_quality_passed:false,ai_generated:false});
  expect(Object.keys(current).some(p=>/source|upload|original_image/i.test(p))).toBe(false);
  const before=await canvasHash(page);await page.reload();await page.locator('#maker-open-file').setInputFiles({name:'project.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(current))});await page.locator('#maker-open').click();await expect(page.locator('#maker-status')).toContainText('制作ZIPを再開しました');await ready(page);expect(await canvasHash(page)).toEqual(before);
  const reopened=unzipSync(await download(page));bytesEqual(reopened['character.inp'],current['character.inp']);expect(json(reopened,'maker_project.json').pose).toEqual(meta.pose);
});
test('PNG and alias ZIP imports keep exact RGBA/source bytes, and missing/opaque/misplaced parts cannot replace a working project',async({page})=>{
  test.setTimeout(90000);await setup(page);const base=unzipSync(await download(page));
  const image=decode(base['parts/bangs_front.png']);let modified=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]&&image.data[i+3]<255){image.data[i]=199;image.data[i+1]=113;image.data[i+2]=59;modified++;}expect(modified).toBeGreaterThan(10);const png=Buffer.from(encode({...image,channels:4,depth:8}));
  const before=await canvasHash(page);await selectPng(page,'front_hair.png',png);expect(await canvasHash(page)).toEqual(before);await page.locator('#maker-apply').click();await expect(page.locator('#maker-status')).toContainText('パーツを交換しました');await ready(page);
  let valid=unzipSync(await download(page));bytesEqual(valid['parts/bangs_front.png'],png);expect(json(valid,'assembly_manifest.json').parts.find(p=>p.role==='bangs_front').origin).toMatchObject({kind:'user-png',ai_origin_verified:false});
  const zipped=zipSync({'parts/left_iris.png':base['parts/iris_l.png']});await page.locator('#maker-part-files').setInputFiles({name:'eyes.zip',mimeType:'application/zip',buffer:Buffer.from(zipped)});await page.locator('#maker-apply').click();await expect(page.locator('#maker-status')).toContainText('パーツを交換しました');await ready(page);valid=unzipSync(await download(page));
  const part=json(valid,'character_manifest.json').parts.find(p=>p.role==='iris_l'),data=new Uint8Array(part.rect.width*part.rect.height*4);data.set([60,30,40,255],0);const tiny=Buffer.from(encode({width:part.rect.width,height:part.rect.height,data,channels:4,depth:8}));
  const bads=[{name:'iris_l.png',buffer:tiny},{name:'eye_l.png',buffer:png},{name:'iris_l.png',buffer:Buffer.from(encode({width:2,height:2,data:new Uint8Array(16),channels:4,depth:8}))}];
  for(const bad of bads){await selectPng(page,bad.name,bad.buffer);await page.locator('#maker-apply').click();await expect(page.locator('#maker-status')).toContainText('保持しています');await ready(page);bytesEqual(unzipSync(await download(page))['character.inp'],valid['character.inp']);}
});
test('a cancelled swap keeps the previous model; undo and restoring a set keep other swaps',async({page})=>{
  test.setTimeout(90000);await setup(page);await swap(page,'bangs');const bangs=unzipSync(await download(page));await page.evaluate(()=>{const e=document.querySelector('#maker-status');const o=new MutationObserver(()=>{if(e.textContent.includes('共通動作')){o.disconnect();document.querySelector('#maker-cancel').click();}});o.observe(e,{childList:true,subtree:true});});await page.locator('#maker-preset-eyes').click();await expect(page.locator('#maker-status')).toContainText('中止');await ready(page);bytesEqual(unzipSync(await download(page))['character.inp'],bangs['character.inp']);
  await swap(page,'eyes');await page.locator('#maker-undo').click();await expect(page.locator('#maker-status')).toContainText('ひとつ前');await ready(page);bytesEqual(unzipSync(await download(page))['character.inp'],bangs['character.inp']);
  await swap(page,'outfit');const outfit=unzipSync(await download(page));await page.locator('#maker-restore').click();await expect(page.locator('#maker-status')).toContainText('基準パーツに戻しました');await ready(page);const restored=unzipSync(await download(page));bytesEqual(restored['parts/bangs_front.png'],restored['base/parts/bangs_front.png']);bytesEqual(restored['parts/dress_base.png'],outfit['parts/dress_base.png']);
});
test('corrupt projects, extra unsafe entries and wrong PNG hashes fail atomically; legacy 33-part ZIP opens',async({page})=>{
  test.setTimeout(90000);await setup(page);const good=unzipSync(await download(page));
  for(const kind of ['hash','history','unknown']){const z={...good};if(kind==='hash'){z['parts/iris_l.png']=z['parts/iris_r.png'];}if(kind==='history'){const m=json(z,'maker_project.json');m.history=[{revision:1,kind:'user-png',label:'fake',changes:[]}];z['maker_project.json']=strToU8(JSON.stringify(m));}if(kind==='unknown')z['private-source.png']=good['preview.png'];await page.locator('#maker-open-file').setInputFiles({name:kind+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(z))});await page.locator('#maker-open').click();await expect(page.locator('#maker-status')).toContainText('保持しています');await ready(page);bytesEqual(unzipSync(await download(page))['character.inp'],good['character.inp']);}
  const legacy=Object.fromEntries(Object.entries(good).filter(([p])=>p==='character_manifest.json'||p.startsWith('parts/')));await page.locator('#maker-open-file').setInputFiles({name:'old.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(legacy))});await page.locator('#maker-open').click();await expect(page.locator('#maker-status')).toContainText('制作ZIPを再開しました');await ready(page);bytesEqual(unzipSync(await download(page))['character.inp'],good['character.inp']);await expect(page.locator('#maker-summary')).toContainText('取り込み 33');
});
test('independent preview changes each control and idle playback stops on mode switch without image POST',async({page})=>{
  let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++;});await setup(page);const neutral=await canvasHash(page);
  for(const name of ['EyeOpenL','EyeOpenR','MouthOpen','HeadX','HeadY','HeadTilt','Breath']){await page.locator('#maker-'+name).fill(name.startsWith('Eye')?'0':'1');expect(await canvasHash(page)).not.toEqual(neutral);await page.locator('#maker-pose-reset').click();expect(await canvasHash(page)).toEqual(neutral);}
  await page.locator('#maker-play').click();await expect(page.locator('#maker-play')).toHaveAttribute('aria-pressed','true');await page.locator('#mode-convert').click();await page.locator('#mode-maker').click();await expect(page.locator('#maker-play')).toHaveAttribute('aria-pressed','false');expect(await canvasHash(page)).toEqual(neutral);expect(posts).toBe(0);
});
test('reference guide is a local download with shared design and per-role anchors, without an AI call',async({page})=>{
  await setup(page);await page.locator('details').filter({has:page.locator('#maker-part-files')}).evaluate(e=>e.open=true);const guide=unzipSync(await download(page,'#maker-guide')),spec=json(guide,'part_request.json');expect(spec.parts).toHaveLength(33);expect(spec.generation_performed).toBe(false);expect(spec.parts.every(p=>p.anchor.length===2&&p.rect.width>0)).toBe(true);expect(guide['shared_reference.png']).toBeTruthy();
});
test('reference-canvas crop preserves original RGBA and rejects background, out-of-range pixels and neck holes',async({page})=>{
  test.setTimeout(90000);await setup(page);const baseline=unzipSync(await download(page)),manifest=json(baseline,'character_manifest.json'),part=manifest.parts.find(p=>p.role==='bangs_front'),crop=decode(baseline[part.file]);
  const full=new Uint8Array(768*1024*4);for(let y=0;y<crop.height;y++)full.set(crop.data.subarray(y*crop.width*4,(y+1)*crop.width*4),((part.rect.y+y)*768+part.rect.x)*4);
  const png=Buffer.from(encode({width:768,height:1024,data:full,channels:4,depth:8}));await selectPng(page,'bangs_front.png',png);await page.locator('#maker-apply').click();await expect(page.locator('#maker-status')).toContainText('パーツを交換しました');await ready(page);const good=unzipSync(await download(page));bytesEqual(decode(good[part.file]).data,crop.data);
  const opaque=new Uint8Array(crop.width*crop.height*4).fill(255),outside=full.slice();outside.set([1,2,3,255],0);const neckPart=manifest.parts.find(p=>p.role==='neck'),neck=decode(baseline[neckPart.file]);
  const pivot=manifest.groups.find(g=>g.id==='group_head').anchor;neck.data[((Math.round(manifest.rig_geometry.neck_follow_y+5)-neckPart.rect.y)*neck.width+Math.round(pivot[0])-neckPart.rect.x)*4+3]=0;
  for(const item of [{name:'bangs_front.png',width:crop.width,height:crop.height,data:opaque},{name:'bangs_front.png',width:768,height:1024,data:outside},{name:'neck.png',width:neck.width,height:neck.height,data:neck.data}]){await selectPng(page,item.name,Buffer.from(encode({...item,channels:4,depth:8})));await page.locator('#maker-apply').click();await expect(page.locator('#maker-status')).toContainText('保持しています');await ready(page);bytesEqual(unzipSync(await download(page))['character.inp'],good['character.inp']);}
});
test('old v1 template ZIP still opens and supports the new cumulative maker without changing the old exporter',async({page})=>{
  await page.goto('/?mode=generate');await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('INP/INX',{timeout:30000});
  const event=page.waitForEvent('download');await page.locator('#cg-download-zip').click();const d=await event,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);
  await page.locator('#mode-maker').click();await page.locator('#maker-open-file').setInputFiles({name:'v1.zip',mimeType:'application/zip',buffer:Buffer.concat(chunks)});await page.locator('#maker-open').click();await expect(page.locator('#maker-status')).toContainText('制作ZIPを再開しました');await ready(page);await swap(page,'bangs');await swap(page,'outfit');const files=unzipSync(await download(page));expect(json(files,'character_manifest.json').version).toBe(1);expect(readModularContainer(files['character.inp']).model.param).toHaveLength(7);
});

// Mandatory actual owner images; no fallback image or paid/image API exists.
import {chromium} from '@playwright/test';
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,basename,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {inspectReferenceHeader} from '../../shared/design-reference.js';
const {values:a}=parseArgs({options:{reference:{type:'string'},bangs:{type:'string'},output:{type:'string'},url:{type:'string',default:'http://127.0.0.1:5173'},'expected-reference-sha':{type:'string'},'expected-bangs-sha':{type:'string'}}});
if(!a.reference||!a.bangs||!a.output)throw new Error('Use --reference ACTUAL_OWNER_COMPLETE_IMAGE --bangs ACTUAL_OWNER_BANGS_PNG --output NEW_PRIVATE_DIR. No image is substituted.');
const root=await realpath(fileURLToPath(new URL('../..',import.meta.url))),out=resolve(a.output),actual=resolve(await realpath(dirname(out)),basename(out)),rel=relative(root,actual);
if(!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw new Error('Output must be outside Git.');
try{await lstat(out);throw new Error('Output exists; nothing was overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
const reference=await readFile(a.reference),bangs=await readFile(a.bangs),sha=b=>createHash('sha256').update(b).digest('hex');
for(const [b,expected] of [[reference,a['expected-reference-sha']],[bangs,a['expected-bangs-sha']]]){if(b.length<33||b.length>8*1024*1024)throw new Error('Actual owner image missing/oversized.');if(expected)assert.equal(sha(b),expected,'Owner image differs.');}
const origin=new URL(a.url);if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new Error('Use a local app origin.');
const referenceType=inspectReferenceHeader(reference).type,referenceExt={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[referenceType];
await mkdir(out,{mode:0o700});await writeFile(resolve(out,'source-bangs-original.png'),bangs);await writeFile(resolve(out,'reference-original.'+referenceExt),reference);
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});let posts=0,external=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{const u=new URL(r.request().url());if(r.request().method()==='POST')posts++;if(u.origin!==origin.origin){external++;return r.abort();}return u.pathname.startsWith('/api/')?r.abort():r.continue();});
  const ready=()=>page.locator('#character-maker-mode[aria-busy="false"]').waitFor({timeout:60000});
  const download=async id=>{const event=page.waitForEvent('download');await page.locator(id).click();const d=await event,chunks=[];for await(const b of await d.createReadStream())chunks.push(b);await ready();return Buffer.concat(chunks);};
  const json=(z,n)=>JSON.parse(strFromU8(z[n]));
  const extract=async(bytes,name)=>{const dir=resolve(out,name);await mkdir(dir,{mode:0o700});await writeFile(resolve(out,name+'.zip'),bytes);const z=unzipSync(bytes);for(const [name,b] of Object.entries(z)){assert.match(name,/^(?:(?:base\/)?parts\/|design\/|hair\/)?[-a-zA-Z0-9_.]+$/);const file=resolve(dir,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,b);}return z;};
  await page.goto(origin.href);await page.locator('#maker-create').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/33パーツを組み立てました/);
  const base=await extract(await download('#maker-save'),'base');await page.locator('#maker-bangs-import').evaluate(e=>e.open=true);await page.locator('#maker-bangs-file').setInputFiles(a.bangs);await page.locator('#maker-bangs-apply').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/装着しました/);
  const before=unzipSync(await download('#maker-save')),nativeSha=sha(before['character.inp']);
  await page.locator('#maker-design-workflow').evaluate(e=>e.open=true);const beforeSelection=await page.locator('#maker-canvas').evaluate(c=>c.toDataURL());await page.locator('#maker-reference-file').setInputFiles(a.reference);assert.equal(await page.locator('#maker-canvas').evaluate(c=>c.toDataURL()),beforeSelection);
  await page.locator('#maker-reference-title').fill('既提供メイド画像（仮原画・前髪との同一性未確認）');const start=Date.now();await page.locator('#maker-reference-register').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/共通原画を登録しました/);const referenceSeconds=(Date.now()-start)/1000;
  const projectBytes=await download('#maker-save'),z=await extract(projectBytes,'project'),meta=json(z,'maker_project.json'),report=json(z,'design/quality.json');assert.equal(meta.version,3);assert.equal(sha(z['character.inp']),nativeSha);assert.ok(Buffer.from(z[meta.design_reference.source.file]).equals(reference));
  for(const p of meta.parts)assert.ok(Buffer.from(z[p.file]).equals(Buffer.from(before[p.file])),p.role+' changed on reference registration');
  // This old front hair was NOT authenticated as being generated with this
  // portrait. Deliberately do NOT tick the declaration or fabricate new side
  // and back hair. Actual quality evidence must remain incomplete.
  assert.equal(report.hair_progress.linked_pngs,0);assert.equal(report.hair_progress.missing_roles.length,4);assert.equal(report.appearance_quality_passed,false);
  const front=report.parts.find(p=>p.role==='bangs_front');assert.equal(front.source_kind,'user-png');assert.equal(front.reference_binding,'not-linked-to-reference');
  for(const role of ['side_hair_l','side_hair_r','back_hair'])assert.equal(report.parts.find(p=>p.role===role).source_kind,'local-template');
  const guide=await download('#maker-reference-guide');await extract(guide,'guide');const review=await download('#maker-reference-review'),rz=await extract(review,'review');assert.ok(Buffer.from(rz[meta.design_reference.source.file]).equals(reference));
  const neutral=await page.locator('#maker-canvas').evaluate(c=>c.toDataURL()),motionChecks={};
  for(const id of ['EyeOpenL','EyeOpenR','MouthOpen','HeadX','HeadY','HeadTilt','Breath']){await page.locator('#maker-'+id).fill(id.startsWith('Eye')?'0':'1');motionChecks[id]=(await page.locator('#maker-canvas').evaluate(c=>c.toDataURL()))!==neutral;assert.equal(motionChecks[id],true);await page.locator('#maker-pose-reset').click();assert.equal(await page.locator('#maker-canvas').evaluate(c=>c.toDataURL()),neutral);}
  for(const kind of ['comparison','hair']){await page.locator(`[data-design-view="${kind}"]`).click();const image=await download('#maker-design-image-save');assert.ok(image.equals(Buffer.from(rz[kind==='hair'?'hair_comparison.png':'reference_comparison.png'])));await writeFile(resolve(out,kind+'-saved-from-dialog.png'),image);await page.screenshot({path:resolve(out,'phone-'+kind+'-viewer.png')});await page.locator('#maker-design-viewer-close').click();}
  await page.locator('#maker-design-state').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,'phone-design-workflow.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.reload();await page.locator('#maker-open-file').setInputFiles(resolve(out,'project.zip'));await page.locator('#maker-open').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/再開しました/);assert.ok((await download('#maker-save')).equals(projectBytes));
  assert.equal(posts,0);assert.equal(external,0);assert.deepEqual(errors,[]);
  const result={format:'ai-live2d-real-reference-design-trial',version:1,reference_sha256:sha(reference),bangs_source_sha256:sha(bangs),reference_use:'provisional previous owner portrait; not authenticated as source design of supplied bangs',actual_owner_reference_used:true,actual_owner_bangs_used:true,no_substitute_assets:true,
    actual_external_parts:1,remaining_parts:'32 local template PNGs; no invented matching side/back hair',reference_registration_seconds:referenceSeconds,reference_original_bytes_preserved:true,registration_preserves_all_33_pngs:true,registration_preserves_native_bytes:true,model_sha256:nativeSha,base_model_sha256:sha(base['character.inp']),
    independently_rendered_motion_changes:motionChecks,reference_hair_linked_pngs:report.hair_progress.linked_pngs,warning_count:report.warning_count,
    source_hair_checks:report.parts.filter(p=>['bangs_front','side_hair_l','side_hair_r','back_hair'].includes(p.role)).map(p=>({role:p.role,source_kind:p.source_kind,reference_binding:p.reference_binding,palette_delta_e76:p.palette_delta_e76,ink_run_proxy_px:p.measurement.ink_run_proxy_px,shading_contrast_ratio:p.shading_contrast_ratio,warning_codes:p.warning_codes})),
    reopened_project_identical:true,guide_bytes:guide.length,review_bytes:review.length,project_bytes:projectBytes.length,local_dialog_png_saving_verified:true,no_image_post:posts===0,no_external_request:external===0,
    official_creator_retested_this_trial:false,iphone_safari_device_tested:false,matched_ai_hair_set_verified:false,appearance_quality_passed:false};
  await writeFile(resolve(out,'validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}

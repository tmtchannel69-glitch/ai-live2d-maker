// Real user-supplied PNG required. Nothing is substituted when it is missing.
import {chromium} from '@playwright/test';
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,basename,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
const {values:a}=parseArgs({options:{source:{type:'string'},output:{type:'string'},url:{type:'string',default:'http://127.0.0.1:5173'},'expected-sha':{type:'string'}}});
if(!a.source||!a.output)throw new Error('Use --source ACTUAL_OWNER_PNG --output NEW_PRIVATE_DIRECTORY. No replacement fixture is provided.');
const root=await realpath(fileURLToPath(new URL('../..',import.meta.url))),out=resolve(a.output),actual=resolve(await realpath(dirname(out)),basename(out)),rel=relative(root,actual);
if(!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw new Error('Output must be outside Git.');
try{await lstat(out);throw new Error('Output exists; nothing was overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
const source=await readFile(resolve(a.source));if(source.length<33||source.length>8*1024*1024)throw new Error('Actual source PNG missing/oversized.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceSha=sha(source);if(a['expected-sha'])assert.equal(sourceSha,a['expected-sha'],'Source differs from the owner’s supplied PNG.');
const url=new URL(a.url);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Use a local app origin.');
await mkdir(out,{mode:0o700});await writeFile(resolve(out,'source-original.png'),source);
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true}),json=(z,n)=>JSON.parse(strFromU8(z[n]));
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});let posts=0,external=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(route.request().method()==='POST')posts++;if(u.origin!==url.origin){external++;return route.abort();}return u.pathname.startsWith('/api/')?route.abort():route.continue();});
 const ready=()=>page.locator('#character-maker-mode[aria-busy="false"]').waitFor();
 const download=async selector=>{const pending=page.waitForEvent('download');await page.locator(selector).click();const file=await pending,chunks=[];for await(const b of await file.createReadStream())chunks.push(b);await ready();return Buffer.concat(chunks);};
 const extract=async(bytes,name)=>{const dir=resolve(out,name);await mkdir(dir,{mode:0o700});await writeFile(resolve(dir,'project.zip'),bytes);const z=unzipSync(bytes);for(const [name,b] of Object.entries(z)){assert.match(name,/^(?:base\/parts\/|parts\/)?[a-zA-Z0-9_.-]+$/);const file=resolve(dir,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,b);}return z;};
 await page.goto(url.href);await page.locator('#maker-create').click();await page.locator('#maker-status').filter({hasText:'33パーツを組み立てました'}).waitFor();await ready();
 const base=await extract(await download('#maker-save'),'base');
 await page.locator('#maker-bangs-import summary').click();const beforeHash=await page.locator('#maker-canvas').evaluate(c=>c.toDataURL());await page.locator('#maker-bangs-file').setInputFiles(resolve(a.source));assert.equal(await page.locator('#maker-canvas').evaluate(c=>c.toDataURL()),beforeHash);assert.equal(posts,0);
 const start=Date.now();await page.locator('#maker-bangs-apply').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/装着しました/);const seconds=(Date.now()-start)/1000;
 const after=await extract(await download('#maker-save'),'attached'),manifest=json(after,'character_manifest.json'),meta=json(after,'maker_project.json');assert.equal(meta.version,2);assert.equal(manifest.parts.length,33);
 for(const p of manifest.parts)if(p.role!=='bangs_front')assert.ok(Buffer.from(base[p.file]).equals(Buffer.from(after[p.file])),p.role+' changed unexpectedly');
 assert.deepEqual(json(base,'inochi_model.json').param,json(after,'inochi_model.json').param,'Common motion bindings were changed instead of reused.');
 assert.equal(meta.parts.find(p=>p.role==='bangs_front').origin.import_preparation.source_sha256,sourceSha);
 const review=await download('#maker-bangs-review');await writeFile(resolve(out,'bangs-comparison.zip'),review);const rz=unzipSync(review),reviewDir=resolve(out,'review');await mkdir(reviewDir,{mode:0o700});for(const [name,b] of Object.entries(rz)){assert.match(name,/^(?:motion\/)?[a-zA-Z0-9_.-]+$/);const file=resolve(reviewDir,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,b);}assert.ok(Buffer.from(rz['source_original.png']).equals(source));
 await page.locator('#maker-undo').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/ひとつ前/);assert.ok(Buffer.from(unzipSync(await download('#maker-save'))['character.inp']).equals(Buffer.from(base['character.inp'])));
 await page.locator('#maker-bangs-apply').click();await ready();const again=unzipSync(await download('#maker-save'));assert.ok(Buffer.from(after['character.inp']).equals(Buffer.from(again['character.inp'])));
 await page.locator('#maker-reset-set').selectOption('bangs');await page.locator('#maker-restore').click();await ready();assert.ok(Buffer.from(unzipSync(await download('#maker-save'))['character.inp']).equals(Buffer.from(base['character.inp'])));
 await page.reload();await page.locator('#maker-open-file').setInputFiles(resolve(out,'attached/project.zip'));await page.locator('#maker-open').click();await ready();assert.match(await page.locator('#maker-status').textContent(),/再開しました/);const reopened=await download('#maker-save');assert.ok(reopened.equals(await readFile(resolve(out,'attached/project.zip'))),'Reopened project ZIP differs.');
 // Restored projects keep all normalised PNGs and preparation metadata; the
 // separate original image is included only in the first private review ZIP.
 await page.locator('#maker-bangs-import summary').click();const reopenedReview=unzipSync(await download('#maker-bangs-review'));assert.ok(!reopenedReview['source_original.png']);assert.equal(json(reopenedReview,'import_report.json').original_source_included,false);
 await page.screenshot({path:resolve(out,'phone-layout.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(posts,0);assert.equal(external,0);assert.deepEqual(errors,[]);
 const report={format:'real-owner-bangs-trial',version:1,source_sha256:sourceSha,source_bytes:source.length,used_real_owner_image:true,no_fallback_asset:true,application_import_seconds:seconds,other_32_pngs_unchanged:true,all_seven_motion_bindings_unchanged:true,undo_restores_original_native:true,reset_restores_original_native:true,repeated_model_identical:true,reopened_project_zip_identical:true,no_image_post:posts===0,no_external_request:external===0,review_bytes:review.length,review_pose_pairs:json(rz,'import_report.json').poses.length,model_sha256:sha(after['character.inp']),official_creator_tested:false,appearance_quality_passed:false};
 await writeFile(resolve(out,'app-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}

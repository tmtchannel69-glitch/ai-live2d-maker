// Private, repeatable functional trial of original local templates. No AI calls.
import {chromium} from '@playwright/test';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {unzipSync} from 'fflate';
const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
const root=process.cwd(),out=resolve(args.output||'');
if(!args.output||!relative(root,out).startsWith('..'))throw new Error('Use --output NEW_PRIVATE_DIRECTORY outside Git.');
try{await access(out);throw new Error('Output already exists. Nothing was overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
const url=new URL(args.url||'http://127.0.0.1:5173');if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Use a local development server.');
await mkdir(out,{recursive:true,mode:0o700});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true});
const summary=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.route('**/*',route=>{const target=new URL(route.request().url());return target.origin===url.origin&&!target.pathname.startsWith('/api/')?route.continue():route.abort();});
  await page.goto(url.href);await page.locator('#maker-create').click();await page.locator('#maker-status').filter({hasText:'33パーツを組み立てました'}).waitFor();
  const download=async()=>{const pending=page.waitForEvent('download');await page.locator('#maker-save').click();const d=await pending,parts=[];for await(const bytes of await d.createReadStream())parts.push(bytes);await page.locator('#character-maker-mode[aria-busy="false"]').waitFor();return Buffer.concat(parts);};
  for(const name of ['base','bangs','eyes','outfit']){
    const start=Date.now();if(name!=='base'){await page.locator('#maker-preset-'+name).click();await page.locator('#character-maker-mode[aria-busy="false"]').waitFor();if(!(await page.locator('#maker-status').textContent()).includes('を交換しました'))throw new Error('Exchange failed: '+name);}
    const folder=resolve(out,name);await mkdir(folder,{mode:0o700});const zip=await download();await writeFile(resolve(folder,'project.zip'),zip);
    const files=unzipSync(zip);for(const [path,bytes] of Object.entries(files)){if(!/^(?:parts\/|base\/parts\/)?[a-zA-Z0-9_.-]+$/.test(path))throw new Error('Unsafe generated path.');const dest=resolve(folder,path);await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});await writeFile(dest,bytes);}
    const model=JSON.parse(new TextDecoder().decode(files['inochi_model.json']));summary.push({name,seconds:(Date.now()-start)/1000,zip_bytes:zip.length,parameters:model.param.map(p=>p.name),ai_generated:false,appearance_quality_passed:false});
    await page.locator('#maker-canvas').screenshot({path:resolve(folder,'app-neutral.png')});
    for(const [control,value] of [['EyeOpenL','0'],['EyeOpenR','0'],['MouthOpen','1'],['HeadX','-1'],['HeadY','1'],['HeadTilt','1'],['Breath','1']]){await page.locator('#maker-'+control).fill(value);await page.locator('#maker-canvas').screenshot({path:resolve(folder,'app-'+control+'.png')});await page.locator('#maker-pose-reset').click();}
  }
  // Real ZIP reopen, through the visible application, with no API requests.
  await page.reload();await page.locator('#maker-open-file').setInputFiles(resolve(out,'outfit/project.zip'));await page.locator('#maker-open').click();await page.locator('#maker-status').filter({hasText:'制作ZIPを再開しました'}).waitFor();await page.locator('#maker-canvas').screenshot({path:resolve(out,'reopened.png')});
  await page.screenshot({path:resolve(out,'iphone-layout.png'),fullPage:true});
  await writeFile(resolve(out,'trial.json'),JSON.stringify({format:'modular-character-local-template-trial',variants:summary,zip_reopened:true,real_chatgpt_parts_tested:false,official_creator_tested:false},null,2)+'\n');console.log(JSON.stringify({output:out,variants:summary,zip_reopened:true}));
}finally{await browser.close();}

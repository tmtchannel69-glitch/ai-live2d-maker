import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname,basename,relative,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(process.env.AI_LIVE2D_PACKAGE_JSON||new URL('../../../package.json',import.meta.url)),{decode}=require('fast-png'),{chromium}=require('@playwright/test');
if(process.argv.length!==4)throw new Error('Usage: node verify.mjs WEB_DIRECTORY NEW_OUTPUT_DIRECTORY');
const root=resolve(process.argv[2]),requested=resolve(process.argv[3]);
const out=join(await realpath(dirname(requested)),basename(requested));
const repo=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),rel=relative(repo,out);
if(!(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)))throw new Error('Screenshots/model diagnostics must be outside Git.');
await mkdir(out);
const paths={'/':'index.html','/index.html':'index.html','/minimal.inp':'minimal.inp','/main.mjs':'main.mjs','/pkg/inochi_browser_preview.js':'pkg/inochi_browser_preview.js','/pkg/inochi_browser_preview_bg.wasm':'pkg/inochi_browser_preview_bg.wasm'};
const server=createServer(async(req,res)=>{const path=paths[req.url];if(!path){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html':(path.endsWith('.js')||path.endsWith('.mjs'))?'text/javascript':path.endsWith('.wasm')?'application/wasm':'application/octet-stream'});res.end(await readFile(root+'/'+path));}catch{res.writeHead(500);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'}),errors=[],consoleErrors=[],requests=[],states={};
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('request',r=>requests.push(r.url()));
 const url=`http://127.0.0.1:${server.address().port}/`;await page.goto(url);await page.waitForFunction(()=>window.modelLoaded||window.modelError,{timeout:20000});
 const modelError=await page.evaluate(()=>window.modelError||null);
 if(!modelError){
  for(const [name,pose] of Object.entries({open:[1,1,0],half:[.5,.5,0],closed:[0,0,0],left_closed:[0,1,0],right_closed:[1,0,0],left_half:[.5,1,0],right_half:[1,.5,0],near_zero_diagnostic:[.0001,.0001,0],head_left:[1,1,-1],head_right:[1,1,1]})){
   const data=await page.evaluate(p=>{window.setPose(...p);return {png:document.querySelector('#canvas').toDataURL('image/png').split(',')[1],deforms:Array.from(window.preview.deforms())};},pose);
   const png=Buffer.from(data.png,'base64');await writeFile(`${out}/${name}.png`,png);const image=decode(png);
   states[name]={requested:pose,pixels:Array.from(image.data),channels:image.channels,width:image.width,height:image.height,deforms:data.deforms,png_sha256:createHash('sha256').update(png).digest('hex')};
  }
  await page.locator('#play').click();await page.waitForTimeout(700);await page.locator('#play').click();await page.screenshot({path:out+'/phone.png',fullPage:true});
 }
 const baselinePixels=states.open?.pixels.slice(),baselineDeforms=states.open?.deforms.slice();
 for(const state of Object.values(states)){state.changed_pixels_from_open=state.pixels.reduce((sum,_,i,a)=>i%4===0?sum+Number(a.slice(i,i+4).some((v,c)=>v!==baselinePixels[i+c])):sum,0);state.max_deform_delta=Math.max(...state.deforms.map((v,i)=>Math.abs(v-baselineDeforms[i])));state.all_deforms_finite=state.deforms.every(Number.isFinite);delete state.pixels;}
 const report={format:'ai-live2d-inox2d-browser-research',version:1,runtime_sha:'d4dd9dd7f16b775042cbda44370570abf9a8cf81',runtime_modified:false,raw_parameters_unmodified:true,source_model_sha256:createHash('sha256').update(await readFile(root+'/minimal.inp')).digest('hex'),backend:'Inox2D OpenGL renderer compiled to WASM WebGL2',browser:'cloud Chromium; not real mobile device',modelError,states,errors,consoleErrors,requested_files:requests.map(s=>new URL(s).pathname),server_only_loopback:true};
 await writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,states:Object.fromEntries(Object.entries(states).map(([n,s])=>[n,{requested:s.requested,changed_pixels_from_open:s.changed_pixels_from_open,max_deform_delta:s.max_deform_delta,all_deforms_finite:s.all_deforms_finite}]))}));
}finally{await browser.close();await new Promise(r=>server.close(r));}

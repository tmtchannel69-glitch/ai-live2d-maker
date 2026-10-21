import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {encode} from 'fast-png';
import {readPsd,writePsd,initializeCanvas} from 'ag-psd';
import {prepareModelPsd} from './prepare.mjs';
import {checkModelFiles,runTool,buildModel} from './run.mjs';
import {createModelBuildServer} from './server.mjs';
initializeCanvas(()=>{throw new Error('No Canvas expected');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
function png(w=32,h=48,color=[210,80,120,255]){const data=new Uint8Array(w*h*4);for(let i=0;i<data.length;i+=4)data.set(color,i);return encode({width:w,height:h,data,channels:4,depth:8});}
function layerPixel(layer,x,y){
  const {width,height,data}=layer.imageData||{};x-=layer.left||0;y-=layer.top||0;
  return data && x>=0 && y>=0 && x<width && y<height?Array.from(data.slice((y*width+x)*4,(y*width+x)*4+4)):[0,0,0,0];
}
const meta=()=>({format:'ai-live2d-maker-authoring-handoff',version:1,containsOriginal:false,live2dCompatible:false,source:{width:32,height:48},parts:[{id:'face_skin',kind:'ai',alignment:'source-canvas',path:'parts/face_skin.png',dimensions:{width:32,height:48}}],expressions:[]});
const bundle=(m,extra={})=>zipSync({'handoff.json':strToU8(JSON.stringify(m)),'parts/face_skin.png':png(),...extra},{level:0});
test('raw AI canvas and placed eye produce correctly classified PSD layers and exact pixels',()=>{const m=meta();m.expressions=[{role:'eye_iris_l',path:'expressions/eye_iris_l.png',width:2,height:2,placement:{x:.5,y:.5,width:.25,height:.25}}];const bytes=bundle(m,{'expressions/eye_iris_l.png':png(2,2)}),original=bytes.slice(),result=prepareModelPsd(bytes),p=readPsd(result.psd,{useImageData:true,skipThumbnail:true});assert.deepEqual([p.width,p.height],[32,48]);assert.deepEqual(p.children.map(c=>c.name),['face','irides left']);assert.deepEqual(layerPixel(p.children[1],16,24),[210,80,120,255]);assert.deepEqual(layerPixel(p.children[1],0,0),[0,0,0,0]);assert.deepEqual(bytes,original);assert.match(result.report.warnings.join(' '),/転写しません/);});
test('face base replaces old face while closed alternatives remain available to the compiler',()=>{const m=meta();m.expressions=['face_base','eye_closed_l'].map(role=>({role,path:`expressions/${role}.png`,width:32,height:48,placement:{x:0,y:0,width:1,height:1}}));const r=prepareModelPsd(bundle(m,{'expressions/face_base.png':png(),'expressions/eye_closed_l.png':png()}));assert.deepEqual(r.report.layers,['face','eye close left']);assert.deepEqual(r.report.differenceRolesIncluded,['eye_closed_l']);const p=readPsd(r.psd,{useImageData:true,skipThumbnail:true});assert.equal(p.children[1].hidden,false);assert.match(r.report.warnings.join(' '),/eye_closed_l/);});
test('compressed, traversing, unknown-role, oversized and incomplete archives fail before model invocation',()=>{assert.throws(()=>prepareModelPsd(zipSync({'handoff.json':strToU8(JSON.stringify(meta()))},{level:6})));assert.throws(()=>prepareModelPsd(bundle(meta(),{'../outside.png':png()})));let m=meta();m.source.width=4096;m.source.height=4096;assert.throws(()=>prepareModelPsd(bundle(m)),/画像量/);m=meta();m.expressions=[{role:'bad',path:'expressions/bad.png'}];assert.throws(()=>prepareModelPsd(bundle(m)));m=meta();m.parts[0].path='parts/missing.png';assert.throws(()=>prepareModelPsd(bundle(m)));m=meta();m.parts[0].kind='demo';assert.throws(()=>prepareModelPsd(bundle(m)),/ありません/);});
test('structural validation explicitly does not claim runtime acceptance and rejects unsafe/missing references',()=>{const moc=new Uint8Array(64);moc.set(strToU8('MOC3'));const refs={Version:3,FileReferences:{Moc:'character.moc3',Textures:['texture.png']}};const files={'character.model3.json':strToU8(JSON.stringify(refs)),'character.moc3':moc,'texture.png':png()};const checked=checkModelFiles(files);assert.equal(checked.officialCoreTested,false);assert.equal(checked.vtubeStudioTested,false);assert.equal(checked.structureChecked,true);delete files['texture.png'];assert.throws(()=>checkModelFiles(files));refs.FileReferences.Moc='../x.moc3';files['character.model3.json']=strToU8(JSON.stringify(refs));assert.throws(()=>checkModelFiles(files));});
test('external tools honor abort, timeout and failure; unconfigured generation refuses inputs',async()=>{const c=new AbortController();const p=runTool(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal});setTimeout(()=>c.abort(),30);await assert.rejects(p,/中止/);await assert.rejects(runTool(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:30}),/制限時間/);await assert.rejects(runTool(process.execPath,['-e','process.exit(7)']),/終了コード 7/);await assert.rejects(buildModel(bundle(meta()),{}),/未設定/);});
test('local HTTP service rejects absent tool and cross-origin images without processing',async()=>{const server=createModelBuildServer({binary:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const url=`http://127.0.0.1:${server.address().port}`;let r=await fetch(url+'/api/model-build/status');assert.equal((await r.json()).configured,false);r=await fetch(url+'/api/model-build',{method:'POST',headers:{'Content-Type':'application/zip'},body:new Uint8Array(1)});assert.equal(r.status,503);r=await fetch(url+'/api/model-build/status',{headers:{Origin:'https://outside.example'}});assert.equal(r.status,403);}finally{await new Promise(r=>server.close(r));}});
test('build isolation removes temporary material files on success and invalid compiler output',async()=>{
  const {mkdtemp,writeFile,readFile,rm,access}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'model-build-test-')),binary=join(dir,'compiler'),record=join(dir,'record.json');
  try{
    const source=`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2),input=args[args.indexOf('--input')+1],out=args[args.indexOf('--output')+1];fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({input,out}));fs.mkdirSync(out);fs.writeFileSync(out+'/model.model3.json',JSON.stringify({Version:3,FileReferences:{Moc:'model.moc3',Textures:['texture.png']}}));const moc=Buffer.alloc(64);moc.write('MOC3');fs.writeFileSync(out+'/model.moc3',moc);fs.writeFileSync(out+'/texture.png',Buffer.from(${JSON.stringify(Array.from(png()))}));`;
    await writeFile(binary,source,{mode:0o700});const result=await buildModel(bundle(meta()),{binary}),entries=unzipSync(result.zip);assert.ok(entries['model.moc3']);assert.equal(result.report.independentRuntime,null);
    const validate="const fs=require('node:fs'),crypto=require('node:crypto');const b=fs.readFileSync(process.argv[1]);console.error('independent runtime diagnostic');console.log(JSON.stringify({consistency:true,finite_default_and_all_parameter_extrema:true,drawable_count:1,texture_indices:[0],model_sha256:crypto.createHash('sha256').update(b).digest('hex')}));";
    const checked=await buildModel(bundle(meta()),{binary,validator:[process.execPath,'-e',validate]});assert.equal(checked.report.independentRuntime.drawable_count,1);
    await assert.rejects(buildModel(bundle(meta()),{binary,validator:[process.execPath,'-e',validate.replace("crypto.createHash('sha256').update(b).digest('hex')","'wrong-sha'")]}),/一致しません/);
    let paths=JSON.parse(await readFile(record,'utf8'));await assert.rejects(access(paths.input));await assert.rejects(access(paths.out));
    await writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),input=a[a.indexOf('--input')+1],out=a[a.indexOf('--output')+1];fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({input,out}));fs.mkdirSync(out);`);await assert.rejects(buildModel(bundle(meta()),{binary}),/model3.json/);paths=JSON.parse(await readFile(record,'utf8'));await assert.rejects(access(paths.input));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('hidden replacement does not remove the visible face and production parts supersede basic duplicates',()=>{const m=meta();m.parts.push({...m.parts[0],id:'face',path:'parts/face.png'});m.expressions=[{role:'face_base',path:'expressions/face_base.png',width:32,height:48,placement:{x:0,y:0,width:1,height:1}}];m.settings={layers:{face_base:{enabled:false,order:0,condition:'always'}}};const r=prepareModelPsd(bundle(m,{'parts/face.png':png(),'expressions/face_base.png':png()}));assert.deepEqual(r.report.layers,['face']);assert.match(r.report.warnings.join(' '),/重複を除外/);});
test('duplicate face-feature colors are reported as candidates and empty/different-color pixels do not create a verdict',async()=>{
  const {findFaceFeatureOverlap}=await import('./source-overlap.mjs');const base=new Uint8ClampedArray(8*8*4),feature=new Uint8ClampedArray(8*8*4);for(let i=0;i<base.length;i+=4){base.set([100,150,200,255],i);feature.set([100,150,200,255],i);}const layers=[{name:'face',imageData:{data:base}},{name:'irides left',imageData:{data:feature}}];assert.equal(findFaceFeatureOverlap(layers)[0].ratio,1);for(let i=0;i<feature.length;i+=4)feature[i]=20;assert.deepEqual(findFaceFeatureOverlap(layers),[]);feature.fill(0);assert.deepEqual(findFaceFeatureOverlap(layers),[]);
});
test('legacy PNG hidden RGB cannot survive the model preparation PSD',()=>{
  const m=meta(),data=new Uint8Array(32*48*4);for(let i=0;i<data.length;i+=4)data.set([180,80,200,0],i);data.set([30,60,90,128],(15*32+12)*4);const r=prepareModelPsd(bundle(m,{'parts/face_skin.png':encode({width:32,height:48,data,channels:4,depth:8})})),psd=readPsd(r.psd,{useImageData:true,skipThumbnail:true});assert.deepEqual(layerPixel(psd.children[0],0,0),[0,0,0,0]);assert.deepEqual(layerPixel(psd.children[0],12,15),[30,60,90,128]);
});
test('recommended motion IDs alone do not prove motion; missing or untested custom rigs are distinguished',async()=>{const {summarizeMotionCoverage}=await import('./motion-coverage.mjs');let c=summarizeMotionCoverage(null);assert.ok(c.every(p=>p.status==='unverified'));c=summarizeMotionCoverage({parameters:[{id:'ParamEyeLOpen',max_output_delta_samples:[0,0,0]},{id:'ParamMouthOpenY',max_output_delta_samples:[0,.02,.05]},{id:'CustomEye',max_output_delta_samples:[.5]}]});assert.equal(c.find(p=>p.id==='ParamEyeLOpen').status,'no_sampled_change');assert.equal(c.find(p=>p.id==='ParamMouthOpenY').status,'sampled_change');assert.equal(c.find(p=>p.id==='ParamEyeROpen').status,'missing_recommended_id');});
test('texture decoding budget rejects too many large atlases before any pixel allocation',()=>{const moc=new Uint8Array(64);moc.set(strToU8('MOC3'));const huge=png(1,1).slice(),v=new DataView(huge.buffer,huge.byteOffset,huge.byteLength);v.setUint32(16,4096);v.setUint32(20,4096);assert.throws(()=>checkModelFiles({'m.model3.json':strToU8(JSON.stringify({Version:3,FileReferences:{Moc:'m.moc3',Textures:['a.png','b.png']}})),'m.moc3':moc,'a.png':huge,'b.png':huge}),/64 MiB/);});

test('enabled closed-eye and closed-mouth variants reach the compiler with exact pixels but not the initial composite',()=>{
  const m=meta(),roles=['eye_closed_l','eye_closed_r','mouth_closed'];m.expressions=roles.map((role,i)=>({role,path:`expressions/${role}.png`,width:2,height:2,placement:{x:.25+i*.125,y:.5,width:.0625,height:2/48}}));
  const entries=Object.fromEntries(roles.map((role,i)=>[`expressions/${role}.png`,png(2,2,[20,40,80+i*40,255])])),bytes=bundle(m,entries),original=bytes.slice(),r=prepareModelPsd(bytes),p=readPsd(r.psd,{useImageData:true,skipThumbnail:true});
  assert.deepEqual(new Set(r.report.differenceRolesIncluded),new Set(roles));assert.equal(p.children.length,4);
  for(const [i,name] of ['eye close left','eye close right','mouth close'].entries()){const child=p.children.find(c=>c.name===name);assert.ok(child);assert.equal(child.hidden,false);const x=8+i*4,y=24;assert.deepEqual(layerPixel(child,x,y),[20,40,80+i*40,255]);}
  assert.deepEqual(Array.from(p.imageData.data.slice((24*32+8)*4,(24*32+8)*4+4)),[210,80,120,255]);assert.deepEqual(bytes,original);
});
test('disabled variants stay excluded and other condition-hidden materials retain old behavior',()=>{
  const m=meta(),roles=['eye_closed_l','eye_closed_r','mouth_closed','face_base','eye_iris_l'];m.expressions=roles.map(role=>({role,path:`expressions/${role}.png`,width:32,height:48,placement:{x:0,y:0,width:1,height:1}}));
  m.settings={layers:Object.fromEntries(roles.map(role=>[role,{enabled:!role.includes('closed'),order:10,condition:'left_closed'}]))};
  const r=prepareModelPsd(bundle(m,Object.fromEntries(roles.map(role=>[`expressions/${role}.png`,png()]))));assert.deepEqual(r.report.layers,['face']);assert.deepEqual(r.report.differenceRolesIncluded,[]);assert.match(r.report.warnings.join(' '),/無効な素材/);assert.match(r.report.warnings.join(' '),/開いた状態で非表示/);
});

test('mouth visibility distinguishes overlapping open and closed layers from the corrected fade-in',async()=>{
  const {summarizeMouthVisibility}=await import('./mouth-visibility.mjs');
  const r={mouth_opacity_samples:{parameter:'ParamMouthOpenY',sample_values:[0,.25,.5,.75,1],drawables:[{id:'ArtMeshMouthOpen',opacity:[1,1,1,1,1]},{id:'ArtMeshMouthOpen_lip_0',opacity:[1,1,1,1,1]},{id:'ArtMeshMouthClose',opacity:[1,.75,.5,.25,0]}]}};
  assert.equal(summarizeMouthVisibility(r).status,'open_layer_visible_at_minimum');
  r.mouth_opacity_samples.drawables[0].opacity[0]=0;r.mouth_opacity_samples.drawables[1].opacity[0]=0;
  const fixed=summarizeMouthVisibility(r);assert.equal(fixed.status,'no_overlap_at_minimum');assert.equal(fixed.sampleValue,0);assert.equal(fixed.closedLayers[0].opacity,1);
});
test('mouth hints remain unverified for custom IDs, absent or malformed samples and excessive records',async()=>{
  const {summarizeMouthVisibility}=await import('./mouth-visibility.mjs');
  const s={parameter:'ParamMouthOpenY',sample_values:[0,.25,.5,.75,1],drawables:[{id:'CustomMouth',opacity:[1,1,1,1,1]}]};
  for(const r of [null,{}, {mouth_opacity_samples:s},{mouth_opacity_samples:{...s,sample_values:[0,.25,NaN,.75,1]}},{mouth_opacity_samples:{...s,drawables:Array(65).fill(s.drawables[0])}}])assert.equal(summarizeMouthVisibility(r).status,'unverified');
});

test('transparent layer margins are cropped while separated source positions, alpha-one edges and composite pixels survive',()=>{
  const m=meta(),source=new Uint8Array(32*48*4),expected=new Uint8ClampedArray(source.length);
  for(let i=0;i<source.length;i+=4)source.set([200,180,90,0],i);
  for(const [x,y,rgba] of [[4,7,[10,20,30,1]],[8,10,[40,50,60,128]],[6,9,[70,80,90,255]]]){source.set(rgba,(y*32+x)*4);expected.set(rgba,(y*32+x)*4);}
  const extras={'parts/face_skin.png':encode({width:32,height:48,data:source,channels:4,depth:8})};
  m.expressions=[['eye_iris_l',24,36,[20,40,60,255]],['eye_iris_r',2,30,[90,70,50,128]]].map(([role,x,y,color])=>{
    extras[`expressions/${role}.png`]=png(2,3,color);
    for(let py=y;py<y+3;py++)for(let px=x;px<x+2;px++)expected.set(color,(py*32+px)*4);
    return {role,path:`expressions/${role}.png`,width:2,height:3,placement:{x:x/32,y:y/48,width:2/32,height:3/48}};
  });
  const bytes=bundle(m,extras),before=bytes.slice(),sourceBefore=source.slice(),r=prepareModelPsd(bytes),p=readPsd(r.psd,{useImageData:true,skipThumbnail:true});
  assert.deepEqual(p.children.map(c=>[c.name,c.left,c.top,c.imageData.width,c.imageData.height]),[['face',4,7,5,4],['irides left',24,36,2,3],['irides right',2,30,2,3]]);
  const restored=new Uint8ClampedArray(expected.length);
  for(const child of p.children){
    assert.equal(child.hidden,false);
    for(let y=0;y<48;y++)for(let x=0;x<32;x++){
      const rgba=layerPixel(child,x,y);if(rgba[3])restored.set(rgba,(y*32+x)*4);else assert.deepEqual(rgba,[0,0,0,0]);
    }
  }
  assert.deepEqual(restored,expected);
  // PSD merged-image encoding has its own low-alpha rounding. Cropping must
  // preserve that existing composite, while layer RGBA above remains exact.
  const reference=readPsd(writePsd({width:32,height:48,children:[{name:'reference',top:0,left:0,imageData:{width:32,height:48,data:expected}}],imageData:{width:32,height:48,data:expected}},{trimImageData:false,noBackground:true,generateThumbnail:false}),{useImageData:true,skipThumbnail:true});
  assert.deepEqual(p.imageData.data,reference.imageData.data);assert.deepEqual(bytes,before);assert.deepEqual(source,sourceBefore);
});

test('overlap hints remain in source coordinates after cropping and fully transparent layers are explicitly rejected',()=>{
  const m=meta(),data=new Uint8Array(32*48*4);
  for(let y=17;y<21;y++)for(let x=11;x<15;x++)data.set([30,60,90,255],(y*32+x)*4);
  m.expressions=[{role:'eye_iris_l',path:'expressions/eye_iris_l.png',width:4,height:4,placement:{x:11/32,y:17/48,width:4/32,height:4/48}}];
  const r=prepareModelPsd(bundle(m,{'parts/face_skin.png':encode({width:32,height:48,data,channels:4,depth:8}),'expressions/eye_iris_l.png':png(4,4,[30,60,90,255])}));
  assert.equal(r.report.sourceOverlapCandidates[0].ratio,1);assert.equal(r.report.sourceOverlapCandidates[0].visiblePixels,16);
  assert.throws(()=>prepareModelPsd(bundle(meta(),{'parts/face_skin.png':png(32,48,[90,80,70,0])})),/透明な画素だけ/);
});

// Exercise preview packaging and its actual inline script without a browser or
// external runtime. Tiny generated PNGs never contain user images.
const blinkPoses={default:{ParamEyeLOpen:1,ParamEyeROpen:1},'both-closed':{ParamEyeLOpen:0,ParamEyeROpen:0},'both-025':{ParamEyeLOpen:.025,ParamEyeROpen:.025},'both-05':{ParamEyeLOpen:.05,ParamEyeROpen:.05},'both-075':{ParamEyeLOpen:.075,ParamEyeROpen:.075},'both-10':{ParamEyeLOpen:.1,ParamEyeROpen:.1},'both-15':{ParamEyeLOpen:.15,ParamEyeROpen:.15},'both-25':{ParamEyeLOpen:.25,ParamEyeROpen:.25},'both-half':{ParamEyeLOpen:.5,ParamEyeROpen:.5},'both-75':{ParamEyeLOpen:.75,ParamEyeROpen:.75}};
async function previewFixture(poses,poseSet){
  const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=await fs.mkdtemp(join(tmpdir(),'preview-contract-')),renders=join(dir,'frames'),output=join(dir,'review.html');await fs.mkdir(renders);
  const report={format:'ai-live2d-independent-cpu-preview',version:1,model_sha256:'a'.repeat(64),poses};if(poseSet)report.pose_set=poseSet;
  await fs.writeFile(join(renders,'preview-report.json'),JSON.stringify(report));
  for(const [index,pose] of Object.keys(poses).entries())for(const area of ['face','full'])await fs.writeFile(join(renders,`${area}-${pose}.png`),png(2,2,[index*10,40,80,255]));
  return {dir,renders,output,fs,join,report,async clean(){await fs.rm(dir,{recursive:true,force:true});}};
}
function previewPayload(html){return JSON.parse(html.match(/<script[^>]*id="data"[^>]*>([\s\S]*?)<\/script>/)[1]);}

test('renderer transition preset covers low blink openings while preserving legacy default and expression poses',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
  // Evaluate only this trusted renderer's pure pose configuration with Python's
  // stdlib, avoiding a dependency on optional NumPy/Pillow or a native runtime.
  const script="import ast,json,pathlib,sys; tree=ast.parse(pathlib.Path(sys.argv[1]).read_text()); node=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='POSE_SETS' for t in n.targets)); scope={}; exec(compile(ast.Module(body=[node],type_ignores=[]),sys.argv[1],'exec'),scope); print(json.dumps(scope['POSE_SETS']))";
  const {stdout}=await promisify(execFile)('python3',['-c',script,fileURLToPath(new URL('./render-preview.py',import.meta.url))],{timeout:10000,maxBuffer:128*1024}),sets=JSON.parse(stdout);
  assert.deepEqual(Object.fromEntries(sets['blink-transitions']),blinkPoses);
  assert.deepEqual(sets.default,[['default',{}],['left-closed',{ParamEyeLOpen:0}],['right-closed',{ParamEyeROpen:0}],['both-closed',{ParamEyeLOpen:0,ParamEyeROpen:0}],['mouth-open',{ParamMouthOpenY:1}],['head-left',{ParamAngleX:-10}],['head-right',{ParamAngleX:10}]]);
  assert.equal(sets.expressions.length,10);assert.deepEqual(Object.fromEntries(sets.expressions)['left-half'],{ParamEyeLOpen:.5});assert.deepEqual(Object.fromEntries(sets.expressions)['both-closed-mouth-open'],{ParamEyeLOpen:0,ParamEyeROpen:0,ParamMouthOpenY:1});
});

test('ten transition frames retain exact PNGs and explicit opening labels in an offline review page',async()=>{
  const {createPreviewPage}=await import('./create-preview-page.mjs'),fixture=await previewFixture(blinkPoses,'blink-transitions');
  try{
    const result=await createPreviewPage(fixture),html=await fixture.fs.readFile(fixture.output,'utf8'),data=previewPayload(html);assert.equal(result.poses,10);assert.equal(result.externalRequests,false);assert.equal(data.poseSet,'blink-transitions');assert.deepEqual(Object.keys(data.frames),Object.keys(blinkPoses));
    for(const pose of Object.keys(blinkPoses))for(const area of ['face','full'])assert.deepEqual(Buffer.from(data.frames[pose][area].split(',')[1],'base64'),await fixture.fs.readFile(fixture.join(fixture.renders,`${area}-${pose}.png`)));
    for(const [pose,opening] of [['both-025','2.5%'],['both-05','5%'],['both-075','7.5%'],['both-10','10%'],['both-15','15%'],['both-25','25%'],['both-75','75%']])assert.equal(data.labels[pose],`両目の開き ${opening}`,`${pose} must state its opening`);
    assert.match(html,/id="previous"/);assert.match(html,/id="next"/);assert.match(html,/min-height:48px/);assert.match(html,/default-src 'none'/);
  }finally{await fixture.clean();}
});

test('legacy expression review pages keep their frames and labels without requiring a pose-set field',async()=>{
  const {createPreviewPage}=await import('./create-preview-page.mjs'),poses={default:{},'left-closed':{ParamEyeLOpen:0},'left-half':{ParamEyeLOpen:.5},'right-closed':{ParamEyeROpen:0},'right-half':{ParamEyeROpen:.5},'both-closed':{ParamEyeLOpen:0,ParamEyeROpen:0},'both-half':{ParamEyeLOpen:.5,ParamEyeROpen:.5},'mouth-half':{ParamMouthOpenY:.5},'mouth-open':{ParamMouthOpenY:1},'both-closed-mouth-open':{ParamEyeLOpen:0,ParamEyeROpen:0,ParamMouthOpenY:1}},fixture=await previewFixture(poses);
  try{assert.equal((await createPreviewPage(fixture)).poses,10);const data=previewPayload(await fixture.fs.readFile(fixture.output,'utf8'));assert.deepEqual(Object.keys(data.frames),Object.keys(poses));assert.equal(data.labels.default,'通常');assert.equal(data.labels['both-closed'],'両目を閉じる');assert.equal(data.labels['both-half'],'両目を半分');assert.equal(data.labels['mouth-open'],'口を開く');}finally{await fixture.clean();}
});

test('subset transition playback and previous/next never select missing frames',async()=>{
  const {createPreviewPage}=await import('./create-preview-page.mjs'),{runInNewContext}=await import('node:vm');
  for(const poses of [{default:blinkPoses.default},{default:blinkPoses.default,'both-075':blinkPoses['both-075']},blinkPoses]){
    const fixture=await previewFixture(poses,'blink-transitions');
    try{
      await createPreviewPage(fixture);const html=await fixture.fs.readFile(fixture.output,'utf8'),payload=previewPayload(html),code=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
      const element=()=>({children:[],dataset:{},value:'',textContent:'',hidden:false,setAttribute(name,value){this[name]=value;},append(child){this.children.push(child);}}),nodes=new Map(),timers=new Map();let clock=0;
      const query=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);};query('#data').textContent=JSON.stringify(payload);query('#area').value='face';query('#background').value='white';
      const document={querySelector:query,createElement:element,addEventListener(){},hidden:false};
      runInNewContext(code,{document,setTimeout(fn,delay){assert.ok(delay>0 && delay<=10000);timers.set(++clock,fn);return clock;},clearTimeout(id){timers.delete(id);}},{timeout:1000});
      const validImages=new Set(Object.values(payload.frames).map(f=>f.face));assert.ok(validImages.has(query('#preview').src));
      const order=Object.keys(poses).sort((a,b)=>poses[a].ParamEyeLOpen-poses[b].ParamEyeLOpen);let selected=order.indexOf('default');
      for(const id of ['#next','#previous','#next']){query(id).onclick();selected=(selected+(id==='#next'?1:-1)+order.length)%order.length;assert.equal(query('#pose').value,order[selected]);assert.ok(validImages.has(query('#preview').src));}
      query('#play').onclick();for(let step=0;step<24;step++){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();assert.ok(validImages.has(query('#preview').src));assert.ok(Object.hasOwn(payload.frames,query('#pose').value));}
      query('#play').onclick();assert.equal(timers.size,0);
    }finally{await fixture.clean();}
  }
});

test('review packaging still rejects unknown poses, eleven frames, oversized downloads and overwrites',async()=>{
  const {createPreviewPage}=await import('./create-preview-page.mjs');
  for(const poses of [{default:{},unknown:{}},{...blinkPoses,'mouth-open':{ParamMouthOpenY:1}}]){
    const fixture=await previewFixture(poses,'blink-transitions');try{await assert.rejects(createPreviewPage(fixture),/構成/);await assert.rejects(fixture.fs.access(fixture.output));}finally{await fixture.clean();}
  }
  const fixture=await previewFixture({default:blinkPoses.default},'blink-transitions');
  try{
    const zip=fixture.join(fixture.dir,'large.zip'),file=await fixture.fs.open(zip,'w');try{await file.write(Buffer.from([80,75,3,4]));await file.truncate(48*1024*1024);}finally{await file.close();}
    await assert.rejects(createPreviewPage({...fixture,work:zip}),/サイズ|大きすぎ|上限/);await assert.rejects(fixture.fs.access(fixture.output));
    await fixture.fs.writeFile(fixture.output,'keep existing page');await assert.rejects(createPreviewPage(fixture),/EEXIST/);assert.equal(await fixture.fs.readFile(fixture.output,'utf8'),'keep existing page');
  }finally{await fixture.clean();}
});

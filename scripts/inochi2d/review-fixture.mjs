// Tiny transport/validation fixture only. This is NOT a functional Inochi model,
// AI output, appearance test, or evidence for an official runtime.
import {zipSync,strToU8} from 'fflate';
import {encode} from 'fast-png';
import {createHash} from 'node:crypto';

export function reviewFixture(){
  const model=strToU8('TRNSRTS\0review transport fixture, not a runtime model');
  const rgba=encode({width:2,height:2,channels:4,depth:8,data:Uint8Array.from([255,150,120,255,255,150,120,255,30,20,20,128,0,0,0,0])});
  const files={'model.inp':model,'model.inx':model};
  const views=['head','blink'].map(id=>({id,size:[2,2],source_roi:[0,0,2,2],frames:Array.from({length:10},(_,i)=>{
    const file=`review/${id}-${String(i).padStart(2,'0')}.png`;files[file]=rgba;
    return {file,state:id==='head'?(i===0?'neutral':`pose-${i}`):String(i/9),parameters:id==='head'?{HeadX:i/9,HeadTilt:0}:{EyeOpenL:i/9,EyeOpenR:i/9},diagnostics:{}};
  })}));
  const review={format:'ai-live2d-maker-model-review',version:1,mode:'detailed-head',renderer:'independent-cpu-serialized-model',model_sha256:createHash('sha256').update(model).digest('hex'),source_size:[2,2],views,file_generation_passed:true,official_creator_tested:false,appearance_quality_passed:false};
  const graph={source:{width:2,height:2},parts:[{id:'head_surface',role:'head_surface',side:null,parent:'head',order:0,source_box_xywh:[0,0,2,2],observed:{rgba:'observed/head_surface.png'},completion:{rgba:null}}]};
  const pipeline={format:'ai-live2d-maker-detailed-head-app-pipeline',version:1,mode:'detailed-head',reviewManifest:'review/review.json',officialCreatorTested:false,appearanceQualityVerified:false};
  files['review/review.json']=strToU8(JSON.stringify(review));files['common/parts.json']=strToU8(JSON.stringify(graph));
  files['generation-report.json']=strToU8(JSON.stringify(pipeline));files['common/observed/head_surface.png']=rgba;
  return {files,review,graph,pipeline,zip:()=>Buffer.from(zipSync(files,{level:6}))};
}

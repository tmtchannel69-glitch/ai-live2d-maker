import {createProjectFile} from './project-file.js';
import {BASIC_IDS,defaultTemplates} from './parts.js';
import {defaultExpressionLayer} from './expression-layer-state.js';
import {defaultDeform} from './expression-deform.js';
import {emptyGroups,suggestedAssignments} from './expression-groups.js';

// All graphics are drawn here from geometric shapes, with no external image.
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
const blob=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('サンプル画像を準備できませんでした。')),'image/png'));
export async function createSampleProject() {
  const width=240,height=320,expressions=[],expressionLayers={},expressionDeforms={},expressionClips={};
  async function add(role,w,h,placement,paint){const c=canvas(w,h);paint(c.getContext('2d'));expressions.push({role,name:`sample-${role}.png`,width:w,height:h,placement,blob:await blob(c)});expressionLayers[role]=defaultExpressionLayer(role);return c;}
  function ellipse(ctx,x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
  const face=await add('face_base',168,208,{x:.15,y:.08,width:.7,height:.65},ctx=>{
    ellipse(ctx,84,104,80,101,'#a697db');ellipse(ctx,84,118,66,78,'#ffe5d4');
    ctx.fillStyle='#a697db';ctx.beginPath();ctx.moveTo(18,55);ctx.lineTo(150,55);ctx.lineTo(129,109);ctx.lineTo(96,83);ctx.lineTo(79,103);ctx.lineTo(53,83);ctx.lineTo(30,110);ctx.fill();
    ellipse(ctx,45,139,12,5,'#f2b5b9');ellipse(ctx,123,139,12,5,'#f2b5b9');ellipse(ctx,84,143,2,3,'#cc9890');
  });
  for(const [side,x] of [['l',.61],['r',.25]]) {
    await add(`eye_white_${side}`,34,20,{x,y:.35,width:34/width,height:20/height},ctx=>ellipse(ctx,17,10,16,9,'#ffffff'));
    await add(`eye_iris_${side}`,14,18,{x:x+10/width,y:.35+1/height,width:14/width,height:18/height},ctx=>{ellipse(ctx,7,9,7,9,'#4c7599');ellipse(ctx,7,10,3,6,'#243650');ellipse(ctx,9,4,2,2,'#ffffff');});
    await add(`eye_lash_${side}`,34,20,{x,y:.35,width:34/width,height:20/height},ctx=>{ctx.strokeStyle='#40324c';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(17,10,16,9,0,Math.PI,Math.PI*2);ctx.stroke();});
    await add(`eye_closed_${side}`,34,12,{x,y:.35+4/height,width:34/width,height:12/height},ctx=>{ctx.strokeStyle='#40324c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(2,6);ctx.quadraticCurveTo(17,12,32,6);ctx.stroke();});
    for(const role of [`eye_white_${side}`,`eye_iris_${side}`,`eye_lash_${side}`]){expressionDeforms[role]=defaultDeform(role);expressionLayers[role].condition='always';}
  }
  await add('mouth_inside',34,22,{x:.43,y:.51,width:34/width,height:22/height},ctx=>{ellipse(ctx,17,11,16,10,'#78394a');ellipse(ctx,17,17,9,3,'#e895a3');});
  const mouth=defaultDeform('mouth_inside');mouth.closed=mouth.open.map(([x,y])=>[x,.05+y*.02]);expressionDeforms.mouth_inside=mouth;expressionLayers.mouth_inside.condition='always';
  await add('mouth_upper',34,5,{x:.43,y:.51,width:34/width,height:5/height},ctx=>{ctx.strokeStyle='#a55e6c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(2,2);ctx.quadraticCurveTo(17,5,32,2);ctx.stroke();});
  for(const side of ['l','r']){const white=expressions.find(a=>a.role===`eye_white_${side}`);expressionClips[`eye_iris_${side}`]={shape:'ellipse',...white.placement};}
  expressionClips.mouth_inside={shape:'ellipse',...expressions.find(a=>a.role==='mouth_inside').placement};
  const expressionGroups=emptyGroups();expressionGroups.assignments=suggestedAssignments(expressions);expressionGroups.clipFollow=Object.fromEntries(Object.keys(expressionClips).map(role=>[role,true]));
  expressionGroups.transforms.face={dx:0,dy:0,pivotX:.5,pivotY:.4,angle:0,scale:1};
  const source=canvas(width,height),ctx=source.getContext('2d');ctx.fillStyle='#786bbb';ctx.beginPath();ctx.roundRect(68,220,104,100,24);ctx.fill();
  ctx.drawImage(face,.15*width,.08*height,.7*width,.65*height);
  for(const a of expressions.filter(a=>a.role!=='face_base' && !a.role.startsWith('eye_closed'))){const bitmap=await createImageBitmap(a.blob);try{const p=a.placement;ctx.drawImage(bitmap,p.x*width,p.y*height,p.width*width,p.height*height);}finally{bitmap.close();}}
  const file=new File([await blob(source)],'sample-character.png',{type:'image/png'});
  const result=await createProjectFile({file,mode:'demo',selected:[...BASIC_IDS],prompts:{},results:[],templates:defaultTemplates(),expressions,expressionLayers,expressionDeforms,expressionClips,expressionGroups});
  return new File([result],'sample-work.zip',{type:'application/zip'});
}

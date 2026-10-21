#!/usr/bin/env node
// Original procedural test artwork. This is not AI separation or a user's model.
import {encode} from 'fast-png';
import {mkdir,realpath,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

function image(width,height){return {width,height,data:new Uint8Array(width*height*4)};}
function shape(im,inside,color){
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){
    let coverage=0;for(const dy of [.25,.75])for(const dx of [.25,.75])if(inside(x+dx,y+dy))coverage+=.25;
    if(!coverage)continue;
    const i=(y*im.width+x)*4,a=color[3]/255*coverage,old=im.data[i+3]/255,out=a+old*(1-a);
    for(let c=0;c<3;c++)im.data[i+c]=Math.round((color[c]*a+im.data[i+c]*old*(1-a))/out);
    im.data[i+3]=Math.round(out*255);
  }
}
function ellipse(im,cx,cy,rx,ry,color){shape(im,(x,y)=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1,color);}
function line(im,points,radius,color){
  shape(im,(x,y)=>points.some((p,index)=>{
    const q=points[index+1];if(!q)return false;
    const dx=q[0]-p[0],dy=q[1]-p[1],t=Math.max(0,Math.min(1,((x-p[0])*dx+(y-p[1])*dy)/(dx*dx+dy*dy)));
    return (x-p[0]-t*dx)**2+(y-p[1]-t*dy)**2<=radius*radius;
  }),color);
}
function curve(a,b,c){return Array.from({length:25},(_,i)=>{const t=i/24;return [0,1].map(k=>(1-t)**2*a[k]+2*(1-t)*t*b[k]+t*t*c[k]);});}
function png(im){return encode({...im,channels:4,depth:8});}
function face(){const im=image(160,220);ellipse(im,80,110,68,104,[103,77,104,255]);ellipse(im,80,109,65.5,101.5,[255,225,208,255]);return im;}
function eye(left){
  const im=image(64,36);ellipse(im,32,18,29,15,[67,55,89,255]);ellipse(im,32,18,27,13,[253,252,255,255]);
  ellipse(im,32,18,11,12.8,[109,151,230,255]);ellipse(im,32,17,6,10,[43,58,110,255]);
  ellipse(im,28,11,3.2,3.2,[255,255,255,255]);ellipse(im,36,24,1.7,1.7,[220,237,255,240]);
  line(im,curve([4,14],[32,-7],[60,14]),1.6,[57,44,76,255]);
  line(im,left?[[58,12],[63,7]]:[[6,12],[1,7]],1.2,[57,44,76,255]);return im;
}
function eyelid(left){
  const im=image(64,16);line(im,curve([4,5],[32,17],[60,5]),1.35,[57,44,76,255]);
  line(im,left?[[58,6],[63,2]]:[[6,6],[1,2]],1.1,[57,44,76,255]);return im;
}
export function fixtureInput(){
  const source={width:256,height:320},specs=[
    ['face_base',face(),48,38,160,220],
    // Left/right refer to the character: its left eye is screen-right.
    ['eye_white_l',eye(true),141,121,48,27],['eye_white_r',eye(false),67,121,48,27],
    ['eye_closed_l',eyelid(true),141,129,48,12],['eye_closed_r',eyelid(false),67,129,48,12],
  ];
  return {name:'Synthetic blink and head-motion fixture',source,parts:specs.map(([role,im,x,y,width,height])=>({role,width:im.width,height:im.height,placement:{x:x/source.width,y:y/source.height,width:width/source.width,height:height/source.height},png:png(im)}))};
}
export async function createFixture(output){
  const repo=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
  output=join(await realpath(dirname(resolve(output))),basename(resolve(output)));
  const rel=relative(repo,output);
  if(!(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)))throw new Error('画像を含む試験素材はGitの外へ保存してください。');
  await mkdir(output,{mode:0o700}); // Exclusive new directory, including symlink rejection.
  await mkdir(join(output,'parts'),{mode:0o700});
  const input=fixtureInput(),manifest={format:'ai-live2d-maker-inochi-input',version:1,name:input.name,source:input.source,synthetic:true,assetLicense:'CC0-1.0',parts:input.parts.map(({png,...part})=>({...part,path:`parts/${part.role}.png`}))};
  await Promise.all(input.parts.map(part=>writeFile(join(output,'parts',`${part.role}.png`),part.png,{flag:'wx',mode:0o600})));
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {output,manifest,parts:input.parts};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw new Error('使い方: create-fixture.mjs --output NEW_OUTSIDE_GIT_DIR');
    const result=await createFixture(args[1]);console.log(JSON.stringify({output:result.output,source:result.manifest.source,roles:result.parts.map(p=>p.role),synthetic:true}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}

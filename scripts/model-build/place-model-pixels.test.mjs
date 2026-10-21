import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode} from 'fast-png';
import {zipSync,strToU8} from 'fflate';
import {initializeCanvas,readPsd} from 'ag-psd';
import {placeModelPixels,placementScratchBytes} from './place-model-pixels.mjs';
import {prepareModelPsd} from './prepare.mjs';
initializeCanvas(()=>{throw new Error('No Canvas expected');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const full={x:0,y:0,width:1,height:1};
function place(input,sourceWidth,sourceHeight,width,height,placement=full){const data=new Uint8ClampedArray(width*height*4);placeModelPixels({input,sourceWidth,sourceHeight,width,height,placement,data});return data;}
function colorImage(width,height,rgba){const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set(rgba,i);return data;}
// Independent tiny-image reference: intersect each source-pixel rectangle with
// each destination pixel in destination coordinates, without separable filtering.
function reference(input,sw,sh,width,height,p){
  const out=new Uint8ClampedArray(width*height*4),sx=p.width*width/sw,sy=p.height*height/sh;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sum=[0,0,0,0];
    for(let j=0;j<sh;j++)for(let i=0;i<sw;i++){
      const left=p.x*width+i*sx,top=p.y*height+j*sy,w=Math.max(0,Math.min(x+1,left+sx)-Math.max(x,left))*Math.max(0,Math.min(y+1,top+sy)-Math.max(y,top)),k=(j*sw+i)*4,a=input[k+3];
      for(let c=0;c<3;c++)sum[c]+=input[k+c]*a*w;sum[3]+=a*w;
    }
    const k=(y*width+x)*4,a=Math.min(255,Math.round(sum[3]));if(a){for(let c=0;c<3;c++)out[k+c]=Math.round(sum[c]/sum[3]);out[k+3]=a;}
  }return out;
}

test('one-pixel lines survive downscaling and transparent hidden RGB cannot bleed into them',()=>{
  const input=colorImage(10,10,[255,0,255,0]);for(let x=0;x<10;x++)input.set([20,40,60,255],(4*10+x)*4);
  const before=input.slice(),out=place(input,10,10,2,2);
  assert.deepEqual(Array.from(out),[20,40,60,51,20,40,60,51,0,0,0,0,0,0,0,0]);assert.deepEqual(input,before);
  const isolated=colorImage(2,2,[0,0,255,0]);isolated.set([255,0,0,255],0);assert.deepEqual(Array.from(place(isolated,2,2,1,1)),[255,0,0,64]);
});

test('fractional edges retain their coverage rather than renormalizing clipped footprints',()=>{
  const out=place(colorImage(2,2,[80,120,160,255]),2,2,4,4,{x:.125,y:.125,width:.25,height:.25});
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.deepEqual(Array.from(out.slice((y*4+x)*4,(y*4+x)*4+4)),x<2 && y<2?[80,120,160,64]:[0,0,0,0]);
});

test('native-size alpha-one pixels and enlarged nearest-neighbor samples stay byte exact',()=>{
  const input=new Uint8Array([1,2,3,1,10,20,30,128,90,100,110,255,200,210,220,0]),before=input.slice();
  assert.deepEqual(Array.from(place(input,2,2,2,2)),[1,2,3,1,10,20,30,128,90,100,110,255,0,0,0,0]);
  const enlarged=place(input,2,2,4,4);for(let y=0;y<4;y++)for(let x=0;x<4;x++){
    const i=(Math.floor(y/2)*2+Math.floor(x/2))*4,expected=input[i+3]?Array.from(input.slice(i,i+4)):[0,0,0,0];assert.deepEqual(Array.from(enlarged.slice((y*4+x)*4,(y*4+x)*4+4)),expected);
  }
  assert.deepEqual(input,before);assert.equal(placementScratchBytes(2,2,2,2,full),0);assert.equal(placementScratchBytes(2,2,4,4,full),0);
});

test('fractionally offset native-size and enlarged placements retain the previous discrete samples',()=>{
  const input=new Uint8Array([10,20,30,1,40,50,60,128,70,80,90,255,100,110,120,0]);
  for(const [size,p,indices] of [[4,{x:.125,y:.125,width:.5,height:.5},[0,0,1]],[8,{x:.0625,y:.0625,width:.5,height:.5},[0,0,0,1,1]]]){
    const out=place(input,2,2,size,size,p);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(indices[y]*2+indices[x])*4,expected=x<indices.length && y<indices.length && input[i+3]?Array.from(input.slice(i,i+4)):[0,0,0,0];
      assert.deepEqual(Array.from(out.slice((y*size+x)*4,(y*size+x)*4+4)),expected);
    }
  }
});

test('mixed-axis scales, offsets and fractional clipping match independent two-dimensional area integration',()=>{
  for(const [sw,sh,width,height,p] of [[11,2,4,9,full],[2,11,9,4,full],[7,9,6,5,{x:.125,y:.1,width:.7,height:.81}],[9,3,5,8,{x:.8,y:.7,width:.7,height:.9}],[3,9,8,5,{x:.1,y:.125,width:.8,height:.7}]]){
    const input=new Uint8Array(sw*sh*4);for(let i=0;i<input.length;i++)input[i]=(i*37+19)%256;for(let i=3;i<input.length;i+=20)input[i]=0;
    const out=place(input,sw,sh,width,height,p),expected=reference(input,sw,sh,width,height,p);
    for(let i=0;i<out.length;i+=4){assert.ok(Math.abs(out[i+3]-expected[i+3])<=1);if(!out[i+3])assert.deepEqual(Array.from(out.slice(i,i+4)),[0,0,0,0]);else if(expected[i+3])for(let c=0;c<3;c++)assert.ok(Math.abs(out[i+c]-expected[i+c])<=1);}
  }
});

test('crossed 4096-to-one scales use bounded scanline storage and source reads',()=>{
  for(const [sw,sh,width,height] of [[4096,1,1,4096],[1,4096,4096,1]]){
    const raw=colorImage(sw,sh,[30,60,90,255]);let reads=0;
    const input=new Proxy(raw,{get(target,key){if(typeof key==='string' && /^\d+$/.test(key))reads++;return Reflect.get(target,key,target);}}),out=place(input,sw,sh,width,height);
    assert.ok(reads<=sw*sh*8,`unexpected repeated source work: ${reads}`);assert.equal(placementScratchBytes(sw,sh,width,height,full),64);
    for(let i=0;i<out.length;i+=4)assert.deepEqual(Array.from(out.slice(i,i+4)),[30,60,90,255]);
  }
  assert.equal(placementScratchBytes(4096,4096,4096,4096,{...full,width:.99999}),256*1024);
});

test('model preparation preserves raw ZIPs and offsets while reporting downsampled closed-eye material',()=>{
  const width=32,height=48,input=colorImage(10,10,[240,80,200,0]);for(let x=0;x<10;x++)input.set([20,40,60,255],(4*10+x)*4);
  const metadata={format:'ai-live2d-maker-authoring-handoff',version:1,containsOriginal:false,live2dCompatible:false,source:{width,height},parts:[{id:'face_skin',kind:'ai',alignment:'source-canvas',path:'parts/face_skin.png',dimensions:{width,height}}],expressions:[{role:'eye_closed_l',path:'expressions/eye_closed_l.png',width:10,height:10,placement:{x:.25,y:.25,width:2/32,height:2/48}}]};
  const bytes=zipSync({'handoff.json':strToU8(JSON.stringify(metadata)),'parts/face_skin.png':encode({width,height,data:colorImage(width,height,[210,180,160,255]),channels:4,depth:8}),'expressions/eye_closed_l.png':encode({width:10,height:10,data:input,channels:4,depth:8})},{level:0}),before=bytes.slice();
  const result=prepareModelPsd(bytes),psd=readPsd(result.psd,{useImageData:true,skipThumbnail:true}),layer=psd.children.find(c=>c.name==='eye close left');
  assert.deepEqual([layer.left,layer.top,layer.imageData.width,layer.imageData.height],[8,12,2,1]);assert.deepEqual(Array.from(layer.imageData.data),[20,40,60,51,20,40,60,51]);
  assert.equal(layer.hidden,false);assert.equal(result.report.resampling,'area-premultiplied-downscale-v1');assert.deepEqual(result.report.downsampledRoles,['eye_closed_l']);assert.deepEqual(bytes,before);
});

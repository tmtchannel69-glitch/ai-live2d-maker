// Deterministic, original synthetic layers; no user/third-party image assets.
import {writePsdBuffer} from 'ag-psd';
import {writeFile} from 'node:fs/promises';
const output=process.argv[2];if(!output)throw new Error('Usage: node scripts/model-build/create-fixture.mjs /path/to/new-fixture.psd');
const width=128,height=192;
const specs=[['back hair',[64,75,44,64],[110,85,180,255]],['topwear',[64,162,37,30],[55,65,120,255]],['neck',[64,121,12,21],[250,210,185,255]],['face',[64,72,32,43],[255,220,195,255]],['eyewhite left',[81,72,10,7],[255,255,255,255]],['eyewhite right',[47,72,10,7],[255,255,255,255]],['irides left',[81,72,4,6],[70,100,180,255]],['irides right',[47,72,4,6],[70,100,180,255]],['mouth open',[64,94,9,5],[140,55,80,255]],['front hair',[64,36,35,16],[130,100,195,255]]];
const children=specs.map(([name,[cx,cy,rx,ry],color])=>{const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)data.set(color,(y*width+x)*4);return {name,top:0,left:0,imageData:{width,height,data}};});
await writeFile(output,writePsdBuffer({width,height,children},{generateThumbnail:false,trimImageData:false,noBackground:true}),{flag:'wx'});
console.log('Created original synthetic 10-layer fixture, 128x192.');

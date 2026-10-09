// Creates synthetic fixtures only. It never reads user artwork or changes app data.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writePsd,readPsd,initializeCanvas} from 'ag-psd';
import {encode,decode} from 'fast-png';
import {zipSync,strToU8} from 'fflate';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--out'))throw new Error('使い方: node scripts/create-cubism-check.mjs [--out 新しい出力フォルダー]');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(args[1]||resolve(root,'test-results','cubism-check'));
await mkdir(dirname(output),{recursive:true});
try {await mkdir(output);}catch(error){if(error.code==='EEXIST')throw new Error('出力先がすでにあります。記録を保護するため上書きしません。--out で別のフォルダーを指定してください。');throw error;}
initializeCanvas(()=>{throw new Error('検証用PSDはCanvasを使いません。');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const width=128,height=192;
function layer(id,name){return {id,name,data:new Uint8ClampedArray(width*height*4)};}
function rectangle(part,x,y,w,h,color){for(let cy=y;cy<y+h;cy++)for(let cx=x;cx<x+w;cx++)part.data.set(color,4*(cy*width+cx));}
const body=layer('body','体・衣装 [body]'),face=layer('face','顔 [face]'),hair=layer('hair','髪 [hair]');
rectangle(body,24,96,80,80,[26,171,185,255]);rectangle(face,40,48,48,64,[242,170,72,255]);
rectangle(hair,32,24,64,40,[133,86,215,255]);rectangle(hair,32,64,64,16,[133,86,215,128]);rectangle(hair,32,80,64,1,[133,86,215,1]);
const layers=[body,face,hair],composite=new Uint8ClampedArray(width*height*4);
for(const part of layers)for(let i=0;i<composite.length;i+=4){
 const sa=part.data[i+3]/255,da=composite[i+3]/255,alpha=sa+da*(1-sa);if(!sa)continue;
 for(let c=0;c<3;c++)composite[i+c]=Math.round((part.data[i+c]*sa+composite[i+c]*da*(1-sa))/alpha);
 composite[i+3]=Math.round(alpha*255);
}
const psd=writePsd({width,height,children:layers.map(part=>({name:part.name,top:0,left:0,right:width,bottom:height,blendMode:'normal',opacity:1,hidden:false,imageData:{width,height,data:part.data}})),imageData:{width,height,data:composite}},{trimImageData:false,noBackground:true,generateThumbnail:false});
const restored=readPsd(psd,{useImageData:true,skipThumbnail:true});
if(restored.width!==width || restored.height!==height || restored.bitsPerChannel!==8 || restored.colorMode!==3 || restored.children.length!==layers.length)throw new Error('検証用PSDの構造が一致しません。');
const entries={'cubism-check.psd':new Uint8Array(psd)};
for(const [index,part] of layers.entries()){
 const actual=restored.children[index];
 if(actual.name!==part.name || actual.left!==0 || actual.top!==0 || actual.right!==width || actual.bottom!==height || !Buffer.from(actual.imageData.data).equals(Buffer.from(part.data)))throw new Error('PSDのレイヤー名・位置・画素が一致しません。');
 const png=encode({width,height,data:part.data,channels:4,depth:8});
 if(!Buffer.from(decode(png).data).equals(Buffer.from(part.data)))throw new Error('参照PNGの画素が一致しません。');
 entries[`layers/${part.id}.png`]=png;
}
entries['composite.png']=encode({width,height,data:composite,channels:4,depth:8});
const expected={format:'ai-live2d-maker-cubism-check',version:1,width,height,colorMode:'RGB',bitsPerChannel:8,iccProfile:'not-embedded',orderBottomToTop:layers.map(p=>p.name),layers:layers.map(p=>({id:p.id,name:p.name,bounds:{left:0,top:0,right:width,bottom:height},opacity:1,blendMode:'normal'})),samples:[{layer:'body',x:28,y:120,rgba:[26,171,185,255]},{layer:'face',x:64,y:90,rgba:[242,170,72,255]},{layer:'hair',x:64,y:36,rgba:[133,86,215,255]},{layer:'hair',x:64,y:70,rgba:[133,86,215,128]},{layer:'hair',x:34,y:80,rgba:[133,86,215,1]},{layer:'hair',x:0,y:0,rgba:[0,0,0,0]}],cubismVerified:false};
entries['expected.json']=strToU8(JSON.stringify(expected,null,2));
entries['RESULT.md']=new Uint8Array(await readFile(resolve(root,'docs','CUBISM_IMPORT_RESULT_TEMPLATE.md')));
entries['README.txt']=strToU8('\uFEFF'+`AI Live2D Maker 検証用キット\r\n\r\nユーザー画像を使わない自作図形です。Cubism対応を保証する素材ではありません。\r\nPSDは128×192、体・衣装／顔／髪の3レイヤー。下から体・衣装→顔→髪です。\r\n髪の下端には半透明の帯（alpha 128）と非常に薄い1pxの行（alpha 1）があります。\r\ncomposite.pngは合成の参照、layers/は各レイヤーの参照、expected.jsonは期待値です。\r\nPSDとPNGはICCプロファイル未埋め込みです。色の実確認は別途必要です。\r\nWindowsのCubism EditorでPSDを新規モデルとして開き、RESULT.mdに結果を記録してください。\r\n公式資料に基づく手順はリポジトリのdocs/CUBISM_IMPORT_GUIDE.mdを参照。\r\nこのファイルを開いてもAI処理・画像送信・課金は行いません。\r\nアプリ出力PSDそのものの実取り込みは、このキットの確認とは別に行ってください。\r\n`);
const hashes=Object.fromEntries(Object.entries(entries).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
entries['SHA256.json']=strToU8(JSON.stringify(hashes,null,2));
for(const [name,bytes] of Object.entries(entries)){const path=resolve(output,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
await writeFile(resolve(output,'cubism-check.zip'),zipSync(entries,{level:0}),{flag:'wx'});
console.log(`検証キットを作成しました: ${output}\nPSD・参照PNGのレイヤー名／位置／画素一致を確認済み。Cubism実読み込みは未実施です。`);

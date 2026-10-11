import {writePsd} from 'ag-psd';
import {pixels,over} from './psd-pixels.js';
import {TEMPLATES,PART_LABELS} from './parts.js';
// Bottom to top. This is a starting order, not an inferred depth map.
const orders={basic:['body','face','hair','eyes'],production:['hair_back','top','jacket','sleeve_r','sleeve_l','neck','face_skin','hair_side_r','hair_side_l','mouth_visible','eye_r','eye_l','brow_r','brow_l','hair_front']};
const MIB=1024*1024;
function fail(message){throw new Error(message);}
self.onmessage=async({data:{file,template,selected,results}})=>{
  try {
    const allowed=TEMPLATES[template]?.map(p=>p.id);
    if(!allowed || !Array.isArray(selected) || new Set(selected).size!==selected.length || selected.some(id=>!allowed.includes(id)))fail('選択項目が正しくありません。');
    const chosen=orders[template].filter(id=>selected.includes(id) && results.some(p=>p.id===id));
    if(!chosen.length)fail('選択中のAI結果がありません。');
    if(results.some(p=>selected.includes(p.id) && !p.ai))fail('PSD試作にはAI分離結果を使ってください。');
    if(chosen.some(id=>results.filter(p=>p.id===id).length!==1))fail('パーツが重複しています。');
    const parts=chosen.map(id=>results.find(p=>p.id===id));
    if(parts.some(p=>p.blob.size>32*MIB) || parts.reduce((n,p)=>n+p.blob.size,0)>100*MIB)fail('PSDの入力が大きすぎます。素材ZIPをご利用ください。');
    let image,width,height;
    try {image=await createImageBitmap(file);width=image.width;height=image.height;}
    finally {image?.close();}
    if(!width || !height || width>4096 || height>4096 || width*height>16_000_000)fail('画像のサイズが制限を超えています。');
    if(width*height*4*(parts.length+1)>128*MIB)fail('PSD試作の画像量上限（展開後128 MiB）を超えています。選択項目を減らすか素材ZIPをご利用ください。');
    const composite=new Uint8ClampedArray(width*height*4),children=[];
    for(const [index,part] of parts.entries()) {
      self.postMessage({progress:`PSD：${index+1} / ${parts.length} レイヤーを準備しています…`});
      const rgba=pixels(new Uint8Array(await part.blob.arrayBuffer()),width,height);
      children.push({name:`${PART_LABELS[part.id]} [${part.id}]`,top:0,left:0,bottom:height,right:width,opacity:1,blendMode:'normal',hidden:false,imageData:{width,height,data:rgba}});
      over(composite,rgba);
    }
    self.postMessage({progress:'PSDファイルを書き出しています…'});
    const buffer=writePsd({width,height,children,imageData:{width,height,data:composite}},{trimImageData:false,noBackground:true,generateThumbnail:false});
    if(buffer.byteLength>100*MIB)fail('PSDの上限100 MiBを超えています。選択項目を減らしてください。');
    self.postMessage({buffer},[buffer]);
  } catch(error) {self.postMessage({error:error.message||'PSDの作成に失敗しました。'});}
};

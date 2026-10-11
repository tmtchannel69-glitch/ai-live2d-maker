import {writePsd} from 'ag-psd';
import {pixels,over} from './psd-pixels.js';
import {EXPRESSION_ROLES,EXPRESSION_ROLE_IDS,validateExpressionAssets} from './expression-assets.js';
import {defaultExpressionLayer,validateExpressionLayers,expressionLayerVisible} from './expression-layer-state.js';
const MIB=1024*1024;
const fail=message=>{throw new Error(message);};
self.onmessage=async({data:{file,assets,layers}})=>{
  try {
    if(!Array.isArray(assets) || !assets.length)fail('追加した表情素材がありません。');
    const metadata=validateExpressionAssets(assets.map(a=>({role:a.role,name:`${a.role}.png`,path:`expressions/${a.role}.png`,width:a.width,height:a.height,placement:a.placement})));
    validateExpressionLayers(layers,metadata);
    if(assets.some(a=>!(a.blob instanceof Blob) || a.blob.size>10*MIB) || assets.reduce((n,a)=>n+a.blob.size,0)>100*MIB)fail('PSDの入力が大きすぎます。各素材10 MiB、合計100 MiBです。');
    let bitmap,width,height;try{bitmap=await createImageBitmap(file);width=bitmap.width;height=bitmap.height;}finally{bitmap?.close();}
    if(!width || !height || width>4096 || height>4096 || width*height>16_000_000)fail('元画像のサイズが制限を超えています。');
    const largest=Math.max(...metadata.map(a=>a.width*a.height));
    if((width*height*(assets.length+3)+largest*2)*4>128*MIB)fail('PSDの画像量上限（展開後128 MiB）を超えています。素材を小さくするか引き継ぎZIPをご利用ください。');
    const layer=a=>layers[a.role]||defaultExpressionLayer(a.role);
    const sorted=[...assets].sort((a,b)=>layer(a).order-layer(b).order || EXPRESSION_ROLE_IDS.indexOf(a.role)-EXPRESSION_ROLE_IDS.indexOf(b.role));
    const composite=new Uint8ClampedArray(width*height*4),children=[],canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
    for(const [index,a] of sorted.entries()){
      self.postMessage({progress:`表情PSD：${index+1} / ${assets.length} レイヤーを準備しています…`});
      const rgba=pixels(new Uint8Array(await a.blob.arrayBuffer()),a.width,a.height),image=new OffscreenCanvas(a.width,a.height),input=image.getContext('2d');
      input.putImageData(new ImageData(rgba,a.width,a.height),0,0);ctx.clearRect(0,0,width,height);
      const p=a.placement;ctx.drawImage(image,p.x*width,p.y*height,p.width*width,p.height*height);
      const data=ctx.getImageData(0,0,width,height).data,hidden=!expressionLayerVisible(layer(a),{left:1,right:1,mouth:1});
      children.push({name:`${EXPRESSION_ROLES.find(([id])=>id===a.role)[1]} [${a.role}]`,top:0,left:0,bottom:height,right:width,opacity:1,blendMode:'normal',hidden,imageData:{width,height,data}});
      if(!hidden)over(composite,data);
      image.width=1;image.height=1;
    }
    self.postMessage({progress:'表情素材のPSDを書き出しています…'});
    const buffer=writePsd({width,height,children,imageData:{width,height,data:composite}},{trimImageData:false,noBackground:true,generateThumbnail:false});
    if(buffer.byteLength>100*MIB)fail('PSDの上限100 MiBを超えています。引き継ぎZIPをご利用ください。');self.postMessage({buffer},[buffer]);
  }catch(e){self.postMessage({error:e.message||'表情PSDの作成に失敗しました。'});}
};

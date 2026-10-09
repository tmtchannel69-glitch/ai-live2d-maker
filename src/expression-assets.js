export const EXPRESSION_ROLES=[
  ['eye_closed_l','閉じた目・左（画面右）'],['eye_closed_r','閉じた目・右（画面左）'],
  ['eye_white_l','白目・左（画面右）'],['eye_white_r','白目・右（画面左）'],
  ['eye_iris_l','瞳・左（画面右）'],['eye_iris_r','瞳・右（画面左）'],
  ['eye_lash_l','まつげ・まぶた・左（画面右）'],['eye_lash_r','まつげ・まぶた・右（画面左）'],
  ['face_base','目・口の下地の肌'],['mouth_upper','上唇'],['mouth_lower','下唇'],
  ['mouth_inside','口の内部'],['mouth_teeth','歯'],['mouth_tongue','舌'],['mouth_closed','閉じた口'],
];
export const EXPRESSION_ROLE_IDS=EXPRESSION_ROLES.map(([id])=>id);
export const MAX_EXPRESSION_BYTES=10*1024*1024;
const fail=()=>{throw new Error('表情素材の画像または配置が正しくありません。');};
export function expressionPngSize(bytes) {
  if(bytes.length<33 || [137,80,78,71,13,10,26,10].some((b,i)=>b!==bytes[i]) || String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')fail();
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=v.getUint32(16),height=v.getUint32(20);
  if(!width || !height || width>4096 || height>4096 || width*height>16_000_000)throw new Error('表情素材は各辺4096 px以下・1600万画素以下にしてください。');
  return {width,height};
}
export function validateExpressionAssets(assets) {
  if(!Array.isArray(assets) || assets.length>EXPRESSION_ROLE_IDS.length || new Set(assets.map(a=>a?.role)).size!==assets.length)fail();
  for(const a of assets) {
    if(!a || Object.keys(a).sort().join(',')!=='height,name,path,placement,role,width' || !EXPRESSION_ROLE_IDS.includes(a.role) || a.path!==`expressions/${a.role}.png` || typeof a.name!=='string' || !a.name.length || a.name.length>120 || /[\\/\x00-\x1f]/.test(a.name))fail();
    if(![a.width,a.height].every(n=>Number.isInteger(n) && n>0 && n<=4096) || a.width*a.height>16_000_000)fail();
    const p=a.placement;
    if(!p || Object.keys(p).sort().join(',')!=='height,width,x,y' || ![p.x,p.y].every(n=>Number.isFinite(n) && n>=0 && n<=1) || ![p.width,p.height].every(n=>Number.isFinite(n) && n>=0.0001 && n<=1))fail();
  }
  return structuredClone(assets);
}
export function defaultExpressionPlacement(image,source) {
  const scale=Math.min(1,source.width/image.width,source.height/image.height);
  const width=Math.max(.0001,image.width*scale/source.width),height=Math.max(.0001,image.height*scale/source.height);
  return {x:(1-width)/2,y:(1-height)/2,width,height};
}
export async function readExpressionImage(file) {
  if(file.type!=='image/png' || !file.size || file.size>MAX_EXPRESSION_BYTES)throw new Error('表情素材は10 MiB以下のPNGを選択してください。透明背景のPNGがおすすめです。');
  const bytes=new Uint8Array(await file.arrayBuffer()),size=expressionPngSize(bytes);let bitmap;
  try {bitmap=await createImageBitmap(file);if(bitmap.width!==size.width || bitmap.height!==size.height)fail();}
  finally {bitmap?.close();}
  return {blob:new Blob([bytes],{type:'image/png'}),name:file.name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,120)||'expression.png',...size};
}

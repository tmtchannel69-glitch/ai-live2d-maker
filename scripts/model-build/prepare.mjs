import {findFaceFeatureOverlap} from './source-overlap.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {writePsd} from 'ag-psd';
import {pixels,over} from '../../src/psd-pixels.js';
import {defaultExpressionLayer,expressionLayerVisible,EXPRESSION_CONDITIONS,validateExpressionLayers} from '../../src/expression-layer-state.js';

const MIB=1024*1024;
const PARTS={hair:'front hair',face:'face',body:'topwear',eyes:'eyes combined',hair_front:'front hair',hair_back:'back hair',hair_side_l:'front hair left',hair_side_r:'front hair right',face_skin:'face',neck:'neck',eye_l:'eye combined left',eye_r:'eye combined right',brow_l:'eyebrow left',brow_r:'eyebrow right',mouth_visible:'mouth open',top:'topwear',jacket:'topwear jacket',sleeve_l:'handwear left',sleeve_r:'handwear right'};
const ROLES={face_base:'face',eye_white_l:'eyewhite left',eye_white_r:'eyewhite right',eye_iris_l:'irides left',eye_iris_r:'irides right',eye_lash_l:'eyelash left',eye_lash_r:'eyelash right',eye_closed_l:'eye close left',eye_closed_r:'eye close right',mouth_upper:'mouth open upper',mouth_lower:'mouth open lower',mouth_inside:'mouth open',mouth_teeth:'tooth-t',mouth_tongue:'tongue',mouth_closed:'mouth close'};
const DIFFERENCE_ROLES=new Set(['eye_closed_l','eye_closed_r','mouth_closed']);
const fail=message=>{throw new Error(message);};
function trimLayer(layer){
  const {width,height,data}=layer.imageData;let left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  if(right<=left || bottom<=top)fail(`${layer.name}: 透明な画素だけの素材はモデル化できません。`);
  if(left===0 && top===0 && right===width && bottom===height)return;
  const w=right-left,h=bottom-top,cropped=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)cropped.set(data.subarray(((top+y)*width+left)*4,((top+y)*width+right)*4),y*w*4);
  layer.left+=left;layer.top+=top;layer.imageData={width:w,height:h,data:cropped};
}
export function prepareModelPsd(bytes){
  if(!bytes.length || bytes.length>100*MIB)fail('入力ZIPは100 MiB以下にしてください。');
  const seen=new Set();let total=0;
  const entries=unzipSync(bytes,{filter:e=>{
    if(seen.size>=48 || seen.has(e.name) || !/^(handoff\.json|README\.txt|MOTION_CHECKLIST\.txt|EXPRESSION_NOTES\.txt|PART_CHECKLIST\.txt|parts\/[a-z_]+\.png|expressions\/[a-z_]+\.png)$/.test(e.name))fail('引き継ぎZIPのファイル構成が正しくありません。');
    seen.add(e.name);total+=e.originalSize;
    if(e.compression!==0 || e.size!==e.originalSize || e.originalSize>32*MIB || total>100*MIB || (e.name==='handoff.json' && e.originalSize>256*1024))fail('ZIPの展開上限または形式が正しくありません。');return true;
  }});
  let meta;try{meta=JSON.parse(strFromU8(entries['handoff.json']));}catch{fail('制作引き継ぎZIPが必要です。');}
  if(meta.format!=='ai-live2d-maker-authoring-handoff' || ![1,2].includes(meta.version) || meta.containsOriginal!==false || meta.live2dCompatible!==false || !Array.isArray(meta.parts) || meta.parts.length>19 || !Array.isArray(meta.expressions) || meta.expressions.length>15)fail('対応する制作引き継ぎZIPが必要です。');
  const {width,height}=meta.source||{};
  if(![width,height].every(n=>Number.isInteger(n) && n>0 && n<=4096) || width*height*(meta.parts.length+meta.expressions.length+4)*4>128*MIB)fail('モデル試作の画像量上限（展開後128 MiB）を超えています。');
  const settings=validateExpressionLayers(meta.settings?.layers||{},meta.expressions);
  const has=role=>meta.expressions.some(a=>a.role===role && expressionLayerVisible(settings[a.role]||defaultExpressionLayer(a.role),{left:1,right:1,mouth:1})),layerSpecs=[],ids=new Set(),warnings=[];
  const aiIds=new Set(meta.parts.filter(p=>p.kind==='ai').map(p=>p.id));
  for(const p of meta.parts){
    if(!PARTS[p.id] || ids.has(p.id) || p.path!==`parts/${p.id}.png`)fail('分離結果のIDまたはパスが正しくありません。');ids.add(p.id);
    if(p.kind==='demo'){warnings.push(`${p.id}: 位置のないデモを除外`);continue;}
    if(p.kind!=='ai' || p.alignment!=='source-canvas' || p.dimensions?.width!==width || p.dimensions?.height!==height)fail('元画像と同じ配置のAI結果が必要です。');
    if((p.id==='hair' && [...aiIds].some(id=>id.startsWith('hair_'))) || (p.id==='face' && aiIds.has('face_skin')) || (p.id==='body' && ['top','jacket','sleeve_l','sleeve_r'].some(id=>aiIds.has(id))) || (p.id==='eyes' && ['eye_l','eye_r'].some(id=>aiIds.has(id)))){warnings.push(`${p.id}: 制作用の細かい分離結果を優先して重複を除外`);continue;}
    if((['face','face_skin'].includes(p.id) && has('face_base')) || (p.id==='mouth_visible' && (has('mouth_inside') || (has('mouth_upper') && has('mouth_lower')))) || (p.id==='eye_l' && has('eye_white_l')) || (p.id==='eye_r' && has('eye_white_r')) || (p.id==='eyes' && (has('eye_white_l') || has('eye_white_r'))))continue;
    layerSpecs.push({name:PARTS[p.id],path:p.path,width,height,placement:{x:0,y:0,width:1,height:1},order:baseOrder(p.id)});
    if(p.id.startsWith('eye') || p.id==='face' || p.id==='face_skin')warnings.push(`${p.id}: 目の細分化や目・口のない肌の用意は自動では行いません`);
  }
  ids.clear();for(const a of meta.expressions){
    if(!ROLES[a.role] || ids.has(a.role) || a.path!==`expressions/${a.role}.png` || ![a.width,a.height].every(n=>Number.isInteger(n) && n>0 && n<=4096) || a.width*a.height>16_000_000)fail('表情素材の情報が正しくありません。');ids.add(a.role);
    const p=a.placement;if(!p || ![p.x,p.y].every(n=>Number.isFinite(n) && n>=0 && n<=1) || ![p.width,p.height].every(n=>Number.isFinite(n) && n>=.0001 && n<=1))fail('素材の配置が正しくありません。');
    const layer=meta.settings?.layers?.[a.role]||defaultExpressionLayer(a.role);
    if(!Number.isInteger(layer.order) || layer.order<0 || layer.order>99 || typeof layer.enabled!=='boolean' || !Object.hasOwn(EXPRESSION_CONDITIONS,layer.condition))fail('素材の表示設定が正しくありません。');
    const initiallyVisible=expressionLayerVisible(layer,{left:1,right:1,mouth:1}),difference=DIFFERENCE_ROLES.has(a.role);
    if(!layer.enabled){warnings.push(`${a.role}: 無効な素材のため除外`);continue;}
    if(!initiallyVisible && !difference){warnings.push(`${a.role}: 開いた状態で非表示のため除外`);continue;}
    if(difference)warnings.push(`${a.role}: 閉じた動きの差分として生成へ渡します。初期表示は生成器の開閉パラメーターで制御します。`);
    layerSpecs.push({...a,name:ROLES[a.role],order:20+layer.order,initiallyVisible,difference});
  }
  if(!layerSpecs.length)fail('モデル化できるAI結果または追加素材がありません。');
  const largest=Math.max(...layerSpecs.map(s=>s.width*s.height));if((width*height*(layerSpecs.length+3)+largest*2)*4>128*MIB)fail('素材を配置するための画像量が上限を超えています。');
  const composite=new Uint8ClampedArray(width*height*4),children=[];
  for(const s of layerSpecs.sort((a,b)=>a.order-b.order)){
    if(!entries[s.path])fail(`素材がありません: ${s.path}`);
    const input=pixels(entries[s.path],s.width,s.height),data=new Uint8ClampedArray(width*height*4),p=s.placement;
    // Place raw PNGs only. The app's mesh/clip/group keys are not compiler inputs.
    for(let y=Math.max(0,Math.floor(p.y*height));y<Math.min(height,Math.ceil((p.y+p.height)*height));y++)for(let x=Math.max(0,Math.floor(p.x*width));x<Math.min(width,Math.ceil((p.x+p.width)*width));x++){
      const sx=Math.min(s.width-1,Math.max(0,Math.floor((x-p.x*width)/(p.width*width)*s.width))),sy=Math.min(s.height-1,Math.max(0,Math.floor((y-p.y*height)/(p.height*height)*s.height)));const sourceIndex=(sy*s.width+sx)*4;if(input[sourceIndex+3]>0)data.set(input.subarray(sourceIndex,sourceIndex+4),(y*width+x)*4);
    }
    // PsdReader retains source visibility, and RigBuilder seeds isVisible from it.
    // Closed variants must remain visible *compiler inputs*; EYE_CLOSE/MOUTH_CLOSE
    // get inverse parameter opacity in psd2live, not a permanently hidden flag.
    children.push({name:s.name,top:0,left:0,hidden:false,imageData:{width,height,data}});
    if(s.initiallyVisible!==false)over(composite,data);
  }
  const overlaps=findFaceFeatureOverlap(children);
  if(overlaps.length)warnings.push('顔の下地と目・口などの素材に同じ色の画素が重なる候補があります。元の顔に絵が残っていないか、開閉時の二重表示を確認してください。同色になる別の絵もあるため自動の不良判定ではありません。');
  warnings.push('アプリの変形・表示範囲・親子・確認メモは転写しません。変換ツールが新しい初期リグを作ります。','隠れた肌・口内部の生成と表情品質の自動保証は行いません。');
  // Composite/overlap checks use source-canvas coordinates above. Pack only the
  // alpha>0 rectangle, keeping its original PSD offset and every visible RGBA
  // value (including alpha 1). This avoids full-canvas transparent atlas tiles
  // without adding Canvas dependencies or changing the source PNGs.
  for(const layer of children)trimLayer(layer);
  const psd=new Uint8Array(writePsd({width,height,children,imageData:{width,height,data:composite}},{trimImageData:false,noBackground:true,generateThumbnail:false}));
  if(psd.length>100*MIB)fail('PSDが100 MiBを超えました。');return {psd,report:{source:{width,height},layers:children.map(c=>c.name),differenceRolesIncluded:layerSpecs.filter(s=>s.difference).map(s=>s.role),warnings,sourceOverlapCandidates:overlaps}};
}
function baseOrder(id){if(id==='hair_back')return 0;if(['body','top','jacket','sleeve_l','sleeve_r'].includes(id))return 1;if(id==='neck')return 2;if(['face','face_skin'].includes(id))return 3;if(id.startsWith('hair'))return 90;return 40;}

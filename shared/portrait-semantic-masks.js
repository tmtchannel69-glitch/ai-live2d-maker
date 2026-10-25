// Explicit six-class visible-pixel contract for MediaPipe SelfieMulticlass.
// Categories are observations of the existing picture, NOT hidden/independent rig parts.
export const MULTICLASS_CATEGORIES=Object.freeze([
  {id:0,key:'background',label:'背景'},
  {id:1,key:'hair',label:'髪（見える範囲）'},
  {id:2,key:'body_skin',label:'身体の肌（見える範囲）'},
  {id:3,key:'face_skin',label:'顔の肌（見える範囲）'},
  {id:4,key:'clothes',label:'衣装（見える範囲）'},
  {id:5,key:'accessories',label:'アクセサリー等（見える範囲）'}
]);
export const MULTICLASS_MODEL_URL='https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
export const MULTICLASS_RUNTIME_VERSION='0.10.35';
const CW=768,CH=1024;
const need=(ok,msg)=>{if(!ok)throw new Error(msg);};
const round=(n)=>Math.round(n*10000)/10000;
export function summarizeMulticlassMask(raw,width,height){
  need((raw instanceof Uint8Array||raw instanceof Uint8ClampedArray)&&
    Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&
    width<=4096&&height<=4096&&raw.length===width*height,
    '分類マスクのサイズが不正です。');
  const count=new Int32Array(6),labels=new Uint8Array(CW*CH);
  for(let y=0;y<CH;y++){
    const sy=Math.min(height-1,Math.floor((y+.5)*height/CH));
    for(let x=0;x<CW;x++){
      const sx=Math.min(width-1,Math.floor((x+.5)*width/CW));
      const label=raw[sy*width+sx];
      need(label<=5,'モデルが未知の分類IDを返しました。');
      const idx=y*CW+x;labels[idx]=label;count[label]++;
    }
  }
  const classes=MULTICLASS_CATEGORIES.map(c=>({...c,pixels:count[c.id],fraction:round(count[c.id]/labels.length)}));
  return {labels,report:{
    format:'ai-live2d-portrait-multiclass-visible-masks',version:1,
    engine:'mediapipe-image-segmenter',runtime_version:MULTICLASS_RUNTIME_VERSION,
    model_url:MULTICLASS_MODEL_URL,category_mask_input_size:[width,height],
    category_mask_output_size:[CW,CH],classes,
    output_type:'visible-category-pixels',input_images:1,visible_category_masks:5,
    ai_model_inference_used:true,source_image_uploaded:false,
    anatomical_landmarks_detected:false,individual_eyes_detected:false,
    individual_mouth_detected:false,back_hair_reconstructed:false,
    hidden_surfaces_recovered:0,independent_rig_parts_generated:0,
    appearance_quality_verified:false,anime_image_accuracy_verified:false,
    note:'Six-category photo-oriented model. Visible pixels are mutually exclusive but not completed Live2D layers.'
  }};
}
export function visibleCategoryImage(rgba,labels,categoryId){
  need(rgba instanceof Uint8ClampedArray&&rgba.length===CW*CH*4,'画像のRGBA画素が不正です。');
  need(labels instanceof Uint8Array&&labels.length===CW*CH,'分類マスクのサイズが不正です。');
  need(Number.isInteger(categoryId)&&categoryId>=1&&categoryId<=5,'表示する分類が不正です。');
  const result=new Uint8ClampedArray(rgba.length);
  for(let i=0;i<labels.length;i++){
    if(labels[i]!==categoryId)continue;
    const k=i*4;
    result[k]=rgba[k];result[k+1]=rgba[k+1];result[k+2]=rgba[k+2];
    result[k+3]=rgba[k+3];
  }
  return result;
}

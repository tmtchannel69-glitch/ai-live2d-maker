// Explicit user-triggered, CPU-only MediaPipe segmentation. This module does
// not run until a person clicks the opt-in button. WASM/model are downloaded
// from public CDNs; inference executes in the browser, not a paid image API.
import {MULTICLASS_MODEL_URL,MULTICLASS_RUNTIME_VERSION,summarizeMulticlassMask} from '../../shared/portrait-semantic-masks.js';
const VISION_CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@'+MULTICLASS_RUNTIME_VERSION;
const VISION_ESM=VISION_CDN+'/vision_bundle.mjs';
const WASM_DIR=VISION_CDN+'/wasm';
const need=(ok,msg)=>{if(!ok)throw new Error(msg);};

export async function runLocalMulticlassSegmentation(imageCanvas,{
  loadTasks=()=>import(/* @vite-ignore */ VISION_ESM),
  onProgress=()=>{}
}={}){
  need(imageCanvas&&imageCanvas.width===768&&imageCanvas.height===1024,
    '768×1024の入力画像が必要です。');
  onProgress('MediaPipeの実行環境を読み込んでいます…');
  const tasks=await loadTasks();
  need(tasks?.FilesetResolver?.forVisionTasks&&tasks?.ImageSegmenter?.createFromOptions,
    'MediaPipeの実行環境を読み込めません。');
  const wasm=await tasks.FilesetResolver.forVisionTasks(WASM_DIR);
  onProgress('分類モデルを読み込んでいます。初回は通信が必要です…');
  let segmenter=null,result=null;
  try{
    segmenter=await tasks.ImageSegmenter.createFromOptions(wasm,{
      baseOptions:{modelAssetPath:MULTICLASS_MODEL_URL,delegate:'CPU'},
      runningMode:'IMAGE',outputCategoryMask:true,outputConfidenceMasks:false
    });
    onProgress('端末内で画像を解析しています…');
    result=segmenter.segment(imageCanvas);
    const mask=result?.categoryMask;
    need(mask&&Number.isInteger(mask.width)&&Number.isInteger(mask.height)&&
      typeof mask.getAsUint8Array==='function',
      '分類モデルから有効なマスクを取得できませんでした。');
    const raw=new Uint8Array(mask.getAsUint8Array());
    const output=summarizeMulticlassMask(raw,mask.width,mask.height);
    const knownLabels=typeof segmenter.getLabels==='function'?segmenter.getLabels():[];
    // If the model provides labels, reject a different ordering rather than
    // silently assigning the wrong anatomy to each category ID.
    if(Array.isArray(knownLabels)&&knownLabels.length){
      const expected=[
        /background/i,/hair/i,/body.?skin|skin.?body/i,/face.?skin|skin.?face/i,
        /cloth|shirt|apparel/i,/other|accessor/i
      ];
      need(knownLabels.length===6&&knownLabels.every((name,i)=>expected[i].test(String(name))),
        '分類モデルのラベル順序が想定と違います。安全のため停止しました。');
    }
    output.report.model_labels=Array.isArray(knownLabels)?knownLabels:[];
    output.report.runtime_delegate='CPU';
    output.report.model_download_required=true;
    output.report.image_processing_location='browser';
    return output;
  }finally{
    try{result?.categoryMask?.close?.();}catch{}
    try{for(const m of result?.confidenceMasks??[])m?.close?.();}catch{}
    try{segmenter?.close?.();}catch{}
  }
}

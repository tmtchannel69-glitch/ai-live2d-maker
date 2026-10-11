import {expressionPngSize,MAX_EXPRESSION_BYTES} from './expression-assets.js';

export function materialRoleAdvice(role) {
  if(role==='face_base')return '下地の肌には、目・口の絵が残らない画像が必要です。顔の分離結果に元の目・口が残っている場合は、そのままコピーしても隠せません。画像編集で用意したPNGを読み込んでください。';
  if(role.startsWith('eye_closed') || role==='mouth_closed')return '閉じた形の絵が必要です。開いた目・口の分離結果をコピーしても閉じた絵にはなりません。別のPNGを用意するか、開いた素材の形の編集で試してください。';
  if(['mouth_inside','mouth_teeth','mouth_tongue'].includes(role))return '元画像に描かれていない口の内部・歯・舌は分離では取り出せません。必要な場合だけ、別途用意した透明PNGを読み込んでください。';
  return '白目・瞳・まつげ・唇を別々に動かす場合は、それぞれだけが描かれた透明PNGが必要です。目や口をまとめた分離結果のコピーでは、自動で細分化されません。';
}

// Only the expanded chooser owns a reduced bitmap. Stale decodes never paint.
export function createMaterialAssignmentPreview({details,canvas,status,getSelection}) {
  let ticket=0,blob=null,file=null;
  function clear(){ticket++;blob=null;file=null;canvas.width=1;canvas.height=1;status.textContent='';}
  async function decode(part,source,token){
    let bitmap;
    try {
      if(!part.blob.size || part.blob.size>MAX_EXPRESSION_BYTES)throw new Error('10 MiB以下のPNGが必要です。');
      const {width,height}=expressionPngSize(new Uint8Array(await part.blob.slice(0,33).arrayBuffer()));
      if(token!==ticket)return;
      const scale=Math.min(1,320/width,480/height);
      bitmap=await createImageBitmap(part.blob,{resizeWidth:Math.max(1,Math.round(width*scale)),resizeHeight:Math.max(1,Math.round(height*scale))});
      const now=getSelection();
      if(token!==ticket || !details.open || now.file!==source || now.part?.blob!==part.blob)return;
      canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);
      status.textContent=`${width} × ${height} px。透明背景でコピー前の結果を表示しています。役割に合う絵か確認してください。`;
    } catch(e){if(token===ticket)status.textContent=`結果のプレビューを表示できませんでした。${e.message} 元の分離結果は保持しています。`;}
    finally {bitmap?.close();}
  }
  function update(){
    const state=getSelection();
    if(!details.open || !state.file || !state.part){clear();return;}
    if(blob===state.part.blob && file===state.file)return;
    clear();blob=state.part.blob;file=state.file;status.textContent='コピー前の結果を読み込んでいます…';
    void decode(state.part,state.file,ticket);
  }
  details.addEventListener('toggle',update);
  return {update,clear};
}

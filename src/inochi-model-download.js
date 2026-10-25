export const MAX_MODEL_ARCHIVE_BYTES=80*1024*1024;

// A missing or understated Content-Length must not bypass the memory bound.
export async function readModelArchive(response,{signal,maxBytes=MAX_MODEL_ARCHIVE_BYTES}={}){
  const length=response.headers.get('Content-Length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes)){
    await response.body?.cancel();throw new Error('モデル出力のサイズが上限を超えています。');
  }
  if(!response.body)throw new Error('モデルの応答が空です。');
  const reader=response.body.getReader(),chunks=[];let received=0;
  try{
    while(true){
      if(signal?.aborted)throw new DOMException('生成を中止しました。','AbortError');
      const {done,value}=await reader.read();if(done)break;
      received+=value.byteLength;
      if(received>maxBytes){await reader.cancel();throw new Error('モデル出力のサイズが上限を超えています。');}
      chunks.push(value);
    }
    if(!received)throw new Error('モデルの応答が空です。');
    const blob=new Blob(chunks,{type:'application/zip'}),signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());
    if(signature[0]!==0x50||signature[1]!==0x4b||signature[2]!==0x03||signature[3]!==0x04)throw new Error('モデルZIPの形式が正しくありません。');
    return blob;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}

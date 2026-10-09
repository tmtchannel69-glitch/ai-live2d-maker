// Encoding runs in a worker so reset can terminate it during large exports.
export function createPsdExport(snapshot,{signal,onProgress=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('中止しました。','AbortError'));return;}
    const worker=new Worker(new URL('./psd-worker.js',import.meta.url),{type:'module'});
    const finish=(error,buffer)=>{worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(new Blob([buffer],{type:'image/vnd.adobe.photoshop'}));};
    const abort=()=>finish(new DOMException('中止しました。','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.progress)onProgress(data.progress);else if(data.error)finish(new Error(data.error));else finish(null,data.buffer);};
    worker.onerror=event=>{event.preventDefault();finish(new Error('PSDの出力処理を開始できませんでした。もう一度お試しください。'));};
    try {worker.postMessage(snapshot);}catch(error){finish(error);}
  });
}

// Shared bounded ZIP intake, adapted from the existing model-review reader.
// Checks central sizes first, then actual streamed output in small chunks.
import {Unzip,UnzipInflate,unzipSync} from 'fflate';
export const safeZipPath=name=>typeof name==='string'&&name.length<=180&&/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p!=='__proto__');
export async function readBoundedZip(blob,{signal,maxBytes=80*1024*1024,maxCompressedBytes=maxBytes,maxFiles=256,allowDirectories=false,label='モデルZIP',limitMessage='モデルZIPは80 MiB以下にしてください。'}={}){
  const need=(value,message)=>{if(!value)throw new Error(message||label+'の確認情報が正しくありません。');};
  const abort=()=>{if(signal?.aborted)throw new DOMException('読み込みを中止しました。','AbortError');};
  need(blob instanceof Blob&&blob.size>22&&blob.size<=maxCompressedBytes,limitMessage);abort();
  const bytes=new Uint8Array(await blob.arrayBuffer());abort();
  const index=new Map();let declared=0;
  try{
    unzipSync(bytes,{filter:e=>{
      const directory=allowDirectories&&e.name.endsWith('/')&&e.originalSize===0;
      need(safeZipPath(directory?e.name.slice(0,-1):e.name)&&!index.has(e.name)&&index.size<maxFiles,label+'の項目数や保存先が正しくありません。');
      need([0,8].includes(e.compression)&&Number.isSafeInteger(e.originalSize)&&e.originalSize>=0&&Number.isSafeInteger(e.size)&&e.size>=0&&e.size<=bytes.length);
      declared+=e.originalSize;need(declared<=maxBytes,'展開後の'+label+'が上限を超えています。');index.set(e.name,e);return false;
    }});
    need(index.size>0);
    const entries=new Map(),pending=new Map();let expanded=0,problem;
    const zip=new Unzip(file=>{
      const expected=index.get(file.name);need(expected&&!pending.has(file.name)&&file.compression===expected.compression);
      need(file.originalSize===undefined||file.originalSize===expected.originalSize);
      const state={chunks:[],size:0,done:false};pending.set(file.name,state);
      file.ondata=(error,chunk,final)=>{
        if(problem)return;if(error){problem=error;return;}
        state.size+=chunk.length;expanded+=chunk.length;
        if(state.size>expected.originalSize||expanded>maxBytes){problem=new Error(label+'の展開サイズが申告値または上限を超えています。');return;}
        state.chunks.push(chunk);
        if(final){
          if(state.size!==expected.originalSize){problem=new Error(label+'の内容が途中で切れています。');return;}
          const data=new Uint8Array(state.size);let offset=0;
          for(const c of state.chunks){data.set(c,offset);offset+=c.length;}
          state.chunks=[];state.done=true;entries.set(file.name,data);
        }
      };file.start();
    });zip.register(UnzipInflate);
    for(let start=0;start<bytes.length;start+=4096){
      abort();zip.push(bytes.subarray(start,start+4096),start+4096>=bytes.length);if(problem)throw problem;
      if(start%(128*1024)===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    need(entries.size===index.size&&[...pending.values()].every(s=>s.done),label+'の内容が不足しています。');abort();return entries;
  }catch(error){abort();throw new Error(label+'を読み込めません。'+error.message);}
}

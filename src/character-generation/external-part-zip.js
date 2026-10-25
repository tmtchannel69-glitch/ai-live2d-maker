// Offline-only ZIP intake for role-named PNGs. The filter rejects unsafe entries
// before decompression. Never treats archives as trusted AI provenance.
import {unzipSync} from 'fflate';
import {matchExternalPartFiles,MAX_PART_BYTES,MAX_BATCH_BYTES} from '../../shared/external-part-file-list.js';

const MAX_ARCHIVE_BYTES=16*1024*1024;
const MAX_ZIP_ENTRIES=64;
const SIDE_CARS=new Set([
  'preview.png','README.txt','INOCHI2D.txt','character.inp','character.inx',
  'character_manifest.json','rig_metadata.json','inochi_intermediate.json',
  'generation_recipe.json','character_design.json','design_blueprint.json',
  'ai_generation_request.json','design_quality.json','inochi_model.json',
  'inochi_rig.json','inochi_report.json','experimental_batch_report.json'
]);
const need=(ok,message)=>{if(!ok)throw new Error(message);};

export async function readExternalPartZip(archive,parts,{signal}={}){
  need(archive instanceof Blob&&archive.size>=22&&archive.size<=MAX_ARCHIVE_BYTES,
    'ZIPは16MB以下のファイルを選択してください。');
  if(signal?.aborted)throw new DOMException('処理を中止しました。','AbortError');
  const data=new Uint8Array(await archive.arrayBuffer());
  if(signal?.aborted)throw new DOMException('処理を中止しました。','AbortError');
  need(data[0]===80&&data[1]===75&&data[2]===3&&data[3]===4,
    'ZIPファイルの形式が正しくありません。');
  // Match roles against the exact design rather than accepting arbitrary paths.
  need(Array.isArray(parts)&&parts.length===33,'33パーツの基準デザインが必要です。');
  const roles=new Set(parts.map(p=>p.role));
  need(roles.size===33,'パーツ役割の定義が重複しています。');
  const entries=new Map(),seenNames=new Set(),seenRoles=new Set();
  let listed=0,totalSize=0;
  const extracted=unzipSync(data,{filter:info=>{
    if(signal?.aborted)throw new DOMException('処理を中止しました。','AbortError');
    listed++;
    need(listed<=MAX_ZIP_ENTRIES,'ZIPに項目が多すぎます。');
    const name=info.name;
    need(typeof name==='string'&&name.length<=160&&!seenNames.has(name),
      'ZIPの同名ファイルが重複しています。');
    seenNames.add(name);
    need(Number.isSafeInteger(info.originalSize)&&info.originalSize>=0&&
      Number.isSafeInteger(info.size)&&info.size>=0,'ZIPのサイズ情報が不正です。');
    need(info.compression===0||info.compression===8,'対応していないZIP圧縮形式です。');
    if(name==='parts/'&&info.originalSize===0)return false;
    if(SIDE_CARS.has(name))return false;
    const match=/^(?:parts\/)?([a-z][a-z0-9_]*)\.png$/.exec(name);
    need(match,'ZIPに未対応のファイル名または不正なパスがあります: '+name);
    const role=match[1];
    need(roles.has(role),'ZIPに未知のパーツがあります: '+name);
    need(!seenRoles.has(role),'ZIP内で同じパーツが重複しています: '+role);
    need(info.originalSize>=33&&info.originalSize<=MAX_PART_BYTES,
      'ZIP内のパーツ画像は1枚8MB以下にしてください: '+role);
    totalSize+=info.originalSize;
    need(totalSize<=MAX_BATCH_BYTES,'ZIP内のPNG合計が12MBを超えています。');
    seenRoles.add(role);entries.set(name,{role,size:info.originalSize});
    return true;
  }});
  need(entries.size>0,'ZIP内に有効なパーツPNGがありません。');
  const files=[];
  for(const [name,meta] of entries){
    const bytes=extracted[name];
    need(bytes instanceof Uint8Array&&bytes.length===meta.size,'ZIPのPNGデータが不完全です: '+name);
    files.push(new File([bytes],meta.role+'.png',{type:'image/png'}));
  }
  const matched=matchExternalPartFiles(files,parts);
  return {files,summary:{provided_count:matched.provided_count,missing_count:matched.missing_count,
    provided_roles:matched.provided_roles,total_input_bytes:matched.total_input_bytes,
    source:'local-zip',ignored_sidecars:listed-entries.size,
    ai_origin_verified:false,no_network_transmission:true}};
}

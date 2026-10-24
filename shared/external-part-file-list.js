// Pure filename/role gate: a browser FileList or an array of named PNG files.
// Never infer a layer from a finished illustration or silently fill missing roles.
export const MAX_BATCH_BYTES=12*1024*1024;
export const MAX_PART_BYTES=8*1024*1024;
const need=(ok,message)=>{if(!ok)throw new Error(message);};

export function matchExternalPartFiles(files,manifestParts){
  need(Array.isArray(manifestParts)&&manifestParts.length===33,'33パーツの基準デザインが必要です。');
  const byRole=new Map();
  for(const part of manifestParts){
    need(part&&typeof part.role==='string'&&/^[a-z][a-z0-9_]*$/.test(part.role)&&!byRole.has(part.role),
      '基準デザインのパーツ定義が不正です。');
    byRole.set(part.role,part);
  }
  const selected=Array.from(files??[]);
  need(selected.length>0&&selected.length<=33,'1〜33枚のPNGを選択してください。');
  const found=new Map();let bytes=0;
  for(const file of selected){
    need(file&&typeof file.name==='string'&&typeof file.size==='number'&&
      /^[a-z][a-z0-9_]*\.png$/.test(file.name),
      'ファイル名は iris_l.png のような正確なパーツ役割名にしてください。');
    const role=file.name.slice(0,-4);
    need(byRole.has(role),'未対応のパーツ名です: '+file.name);
    need(!found.has(role),'同じパーツが重複しています: '+file.name);
    need(file.size>=33&&file.size<=MAX_PART_BYTES,'画像1枚は8MB以下の透過PNGが必要です: '+file.name);
    need(file.type===''||file.type==='image/png','PNG以外の形式です: '+file.name);
    bytes+=file.size;
    need(bytes<=MAX_BATCH_BYTES,'画像ファイルの合計は12MB以下にしてください。');
    found.set(role,file);
  }
  const uploads=manifestParts.filter(p=>found.has(p.role)).map(p=>({role:p.role,part:p,file:found.get(p.role)}));
  return {uploads,provided_roles:uploads.map(p=>p.role),missing_roles:manifestParts.filter(p=>!found.has(p.role)).map(p=>p.role),
    provided_count:uploads.length,missing_count:33-uploads.length,total_input_bytes:bytes};
}

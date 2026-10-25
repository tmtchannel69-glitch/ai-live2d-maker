// A local reference is a design contract, never proof of AI origin or art quality.
export const DESIGN_HAIR_ROLES=Object.freeze(['bangs_front','side_hair_l','side_hair_r','back_hair']);
export const REFERENCE_LIMITS=Object.freeze({bytes:8*1024*1024,side:4096,pixels:8_000_000});
export const DEFAULT_STYLE_POLICY=Object.freeze({line_width_px:null,hair_palette:[],shading:'reference',lighting:'reference'});
const need=(v,s)=>{if(!v)throw new Error(s);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
export function validateStylePolicy(p){
  need(exact(p,['line_width_px','hair_palette','shading','lighting']),'共通の画風条件が正しくありません。');
  need(p.line_width_px===null||Number.isFinite(p.line_width_px)&&p.line_width_px>=.5&&p.line_width_px<=12,'線幅は未指定、または基準キャンバス上で0.5〜12pxにしてください。');
  need(Array.isArray(p.hair_palette)&&p.hair_palette.length<=5&&p.hair_palette.every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/.test(c)),'髪の指定色は小文字のHEX色で5色までです。');
  need(['reference','soft-cel','smooth-painterly'].includes(p.shading)&&['reference','upper-left','upper-right','front'].includes(p.lighting),'陰影・光源の指定が正しくありません。');
  return structuredClone(p);
}
export function validateReferenceMeta(m){
  need(exact(m,['format','version','label','source','policy','policy_sha256','claim','ai_origin_verified','appearance_quality_passed'])&&m.format==='ai-live2d-design-reference'&&m.version===1,'共通原画の形式が正しくありません。');
  need(typeof m.label==='string'&&m.label.trim().length>0&&m.label.length<=80&&!/[\x00-\x1f]/.test(m.label),'原画の名前は1〜80文字にしてください。');
  const s=m.source,extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
  need(exact(s,['file','media_type','bytes','width','height','sha256'])&&extensions[s.media_type]&&s.file==='design/reference.'+extensions[s.media_type]&&hash(s.sha256),'原画の保存先・形式・指紋が正しくありません。');
  need(Number.isSafeInteger(s.bytes)&&s.bytes>=33&&s.bytes<=REFERENCE_LIMITS.bytes&&[s.width,s.height].every(n=>Number.isInteger(n)&&n>=64&&n<=REFERENCE_LIMITS.side)&&s.width*s.height<=REFERENCE_LIMITS.pixels,'原画は8 MiB・64〜4096px・800万画素以下にしてください。');
  validateStylePolicy(m.policy);need(hash(m.policy_sha256)&&m.claim==='user-supplied-unverified'&&m.ai_origin_verified===false&&m.appearance_quality_passed===false,'原画の由来・品質を自動合格にできません。');
  return structuredClone(m);
}
export function validateDesignBinding(b){
  need(exact(b,['format','version','reference_sha256','policy_sha256','claim','ai_origin_verified'])&&b.format==='ai-live2d-design-part-binding'&&b.version===1&&hash(b.reference_sha256)&&hash(b.policy_sha256)&&b.claim==='user-declared-common-reference'&&b.ai_origin_verified===false,'パーツと共通原画の関連付けが正しくありません。');
  return structuredClone(b);
}
export function bindingMatches(origin,reference){
  if(!origin?.design_binding)return false;
  const b=validateDesignBinding(origin.design_binding),m=validateReferenceMeta(reference);
  return b.reference_sha256===m.source.sha256&&b.policy_sha256===m.policy_sha256;
}
// Read dimensions BEFORE allocating browser image resources. No SVG, animated
// GIF, or a MIME label alone can pass as a design reference.
export function inspectReferenceHeader(bytes){
  need(bytes instanceof Uint8Array&&bytes.length>=33&&bytes.length<=REFERENCE_LIMITS.bytes,'原画はPNG/JPEG/WebP、8 MiB以下にしてください。');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(n,k)=>String.fromCharCode(...bytes.subarray(n,n+k));
  let width,height,type;
  if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&ascii(12,4)==='IHDR'&&v.getUint32(8)===13){type='image/png';width=v.getUint32(16);height=v.getUint32(20);}
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
    type='image/jpeg';let i=2;
    while(i+3<bytes.length){
      if(bytes[i++]!==255)break;while(bytes[i]===255)i++;const marker=bytes[i++];
      if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(i+2>bytes.length)break;const length=v.getUint16(i);if(length<2||i+length>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=v.getUint16(i+3);width=v.getUint16(i+5);break;}i+=length;
    }
  }else if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'&&v.getUint32(4,true)+8===bytes.length){
    type='image/webp';const kind=ascii(12,4),u24=i=>bytes[i]|bytes[i+1]<<8|bytes[i+2]<<16;
    if(kind==='VP8X'){need(!(bytes[20]&2),'動くWebPではなく静止した原画を使用してください。');width=u24(24)+1;height=u24(27)+1;}
    else if(kind==='VP8L'&&bytes[20]===47){const packed=v.getUint32(21,true);width=(packed&16383)+1;height=(packed>>>14&16383)+1;}
    else if(kind==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
  }
  need(type&&[width,height].every(n=>Number.isInteger(n)&&n>=64&&n<=REFERENCE_LIMITS.side)&&width*height<=REFERENCE_LIMITS.pixels,'原画はPNG/JPEG/WebP、64〜4096px・800万画素以下にしてください。');
  return {type,width,height};
}

// A bounded, explicit extension of the canonical 33-part design. The original
// blueprint remains the reference; only the front-hair rectangle may differ.
import {validateDesignedCharacter,sameJSONData} from './designed-character.js';
import {validateGeneratedGeometry} from './generated-character.js';
const need=(v,m)=>{if(!v)throw new Error(m);};
export function canonicalBangsManifest(manifest){
  if(!manifest?.assembly_extension)return manifest;
  const base=structuredClone(manifest);delete base.assembly_extension;
  const part=base.parts?.find(p=>p.role==='bangs_front'),reference=base.blueprint?.parts?.find(p=>p.role==='bangs_front');
  need(part&&reference,'前髪の基準配置がありません。');part.rect=structuredClone(reference.rect);return base;
}
export async function validateBangsPlacement(manifest){
  const base=await validateDesignedCharacter(canonicalBangsManifest(manifest)),ext=manifest.assembly_extension;
  need(ext&&sameJSONData(Object.keys(ext).sort(),['format','rect','role','version'])&&ext.format==='ai-live2d-bangs-placement'&&ext.version===1&&ext.role==='bangs_front','前髪配置拡張の形式が正しくありません。');
  const ref=base.parts.find(p=>p.role==='bangs_front'),back=base.parts.find(p=>p.role==='back_hair'),face=base.parts.find(p=>p.role==='face_base'),q=ext.rect;
  need(q&&sameJSONData(Object.keys(q).sort(),['height','width','x','y'])&&Object.values(q).every(Number.isInteger),'前髪配置の寸法が正しくありません。');
  need(q.x>=Math.max(0,ref.rect.x-80)&&q.x+q.width<=ref.rect.x+ref.rect.width+80&&q.y>=Math.max(0,back.rect.y-32)&&q.y<=ref.rect.y+12&&q.y+q.height<=face.rect.y+face.rect.height+12&&q.width>=ref.rect.width*.75&&q.width<=ref.rect.width*1.4&&q.height>=ref.rect.height*.75,'前髪配置が対応する頭部の範囲を超えています。');
  need(sameJSONData(manifest.parts.find(p=>p.role==='bangs_front').rect,q),'前髪の配置と拡張情報が一致しません。');
  // Restoring only this rectangle must reproduce the exact canonical design.
  // A modified parent/anchor/order/other role never bypasses the old validator.
  validateGeneratedGeometry(manifest);return manifest;
}
export async function withBangsPlacement(baseline,rect){
  const base=await validateDesignedCharacter(canonicalBangsManifest(baseline)),m=structuredClone(base);
  // Fresh generator manifests share blueprint.parts and parts by reference.
  // Keep the immutable design blueprint separate before changing one rectangle.
  m.parts=structuredClone(base.parts);
  m.assembly_extension={format:'ai-live2d-bangs-placement',version:1,role:'bangs_front',rect:structuredClone(rect)};
  m.parts.find(p=>p.role==='bangs_front').rect=structuredClone(rect);return validateBangsPlacement(m);
}

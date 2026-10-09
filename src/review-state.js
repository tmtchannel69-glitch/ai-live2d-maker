import { ALL_IDS } from './parts.js';
export const emptyReview = () => ({boundary:'unchecked',fill:'unknown',note:''});
export function validateReviews(value,parts) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('確認記録が正しくありません。');
  for(const [id,record] of Object.entries(value)) {
    if(!ALL_IDS.includes(id) || !record || typeof record!=='object' || Array.isArray(record) || Object.keys(record).length!==3 || Object.keys(record).some(key=>!['boundary','fill','note'].includes(key)) || !['unchecked','checked','needs_fix'].includes(record.boundary) || !['unknown','needed','not_needed'].includes(record.fill) || typeof record.note!=='string' || record.note.length>500 || (record.boundary==='checked' && !parts.some(part=>part.id===id && part.ai)))throw new Error('確認記録が正しくありません。');
  }
  return structuredClone(value);
}
export function invalidateReview(record) {
  return {...record,boundary:'unchecked',fill:record.fill==='not_needed'?'unknown':record.fill};
}

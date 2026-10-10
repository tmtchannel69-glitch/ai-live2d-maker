import {EXPRESSION_ROLE_IDS} from './expression-assets.js';

// Regions stay in source-image coordinates, independent of the material mesh.
export function validateClips(value,assets) {
  const invalid=()=>{throw new Error('素材の表示範囲が正しくありません。長方形または楕円と、範囲内の位置・大きさを指定してください。');};
  if(!value || typeof value!=='object' || Array.isArray(value))invalid();
  for(const [role,s] of Object.entries(value)) {
    if(!EXPRESSION_ROLE_IDS.includes(role) || !assets.some(a=>a.role===role) || !s || typeof s!=='object' || Array.isArray(s) || Object.keys(s).sort().join(',')!=='height,shape,width,x,y' || !['rect','ellipse'].includes(s.shape))invalid();
    for(const k of ['x','y','width','height'])if(typeof s[k]!=='number' || !Number.isFinite(s[k]) || s[k]<(k==='x'||k==='y'?0:.0001) || s[k]>1)invalid();
  }
  return structuredClone(value);
}
export function clipPath(ctx,s,width,height) {
  const x=s.x*width,y=s.y*height,w=s.width*width,h=s.height*height;
  ctx.beginPath();
  if(s.shape==='ellipse')ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);
  else ctx.rect(x,y,w,h);
}

import {EXPRESSION_ROLE_IDS} from './expression-assets.js';

export const GRID = Array.from({length:9},(_,i)=>[i%3/2,Math.floor(i/3)/2]);
export const TRIANGLES = [[0,1,3],[1,4,3],[1,2,4],[2,5,4],[3,4,6],[4,7,6],[4,5,7],[5,8,7]];
const area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export const interpolateShape=(setting,value)=>setting.closed.map((p,i)=>p.map((v,k)=>v+(setting.open[i][k]-v)*value));
export function defaultDeform(role) {
  return {driver:role.endsWith('_l')?'left':role.endsWith('_r')?'right':'mouth',closed:GRID.map(([x,y])=>[x,.45+y*.1]),open:GRID.map(p=>[...p])};
}
export function validateDeforms(value,assets) {
  const fail=()=>{throw new Error('変形設定が正しくありません。点の交差・折り返しや範囲外の値を確認してください。');};
  if(!value || typeof value!=='object' || Array.isArray(value))fail();
  for(const [role,s] of Object.entries(value)) {
    if(!EXPRESSION_ROLE_IDS.includes(role) || !assets.some(a=>a.role===role) || !s || typeof s!=='object' || Array.isArray(s) || Object.keys(s).length!==3 || Object.keys(s).some(k=>!['driver','closed','open'].includes(k)) || !['left','right','mouth'].includes(s.driver))fail();
    for(const points of [s.closed,s.open])if(!Array.isArray(points) || points.length!==9 || points.some(p=>!Array.isArray(p) || p.length!==2 || p.some(v=>typeof v!=='number' || !Number.isFinite(v) || v<-.5 || v>1.5)))fail();
    // Each triangle's signed area is quadratic in the parameter. Check its
    // endpoints and internal minimum so a fold between valid keys is rejected.
    const middle=interpolateShape(s,.5);
    for(const ids of TRIANGLES) {
      const f=points=>area(...ids.map(i=>points[i])),c=f(s.closed),end=f(s.open),mid=f(middle),a=2*(end+c-2*mid),b=end-c-a;
      if(Math.min(c,end)<=.00001)fail();
      const t=a>0?-b/(2*a):-1;
      if(t>0 && t<1 && a*t*t+b*t+c<=.00001)fail();
    }
  }
  return structuredClone(value);
}

// Piecewise affine texture mapping. Coordinates are local to the asset's
// placement; the original PNG remains untouched.
export function drawDeformed(ctx,bitmap,placement,points,width,height) {
  const target=points.map(([x,y])=>[(placement.x+x*placement.width)*width,(placement.y+y*placement.height)*height]);
  for(const ids of TRIANGLES) {
    const [s0,s1,s2]=ids.map(i=>[GRID[i][0]*bitmap.width,GRID[i][1]*bitmap.height]),[d0,d1,d2]=ids.map(i=>target[i]);
    const ux=s1[0]-s0[0],uy=s1[1]-s0[1],vx=s2[0]-s0[0],vy=s2[1]-s0[1],det=ux*vy-uy*vx;
    const dx=d1[0]-d0[0],dy=d1[1]-d0[1],ex=d2[0]-d0[0],ey=d2[1]-d0[1];
    const a=(dx*vy-ex*uy)/det,b=(dy*vy-ey*uy)/det,c=(ex*ux-dx*vx)/det,d=(ey*ux-dy*vx)/det;
    ctx.save();ctx.beginPath();ctx.moveTo(...d0);ctx.lineTo(...d1);ctx.lineTo(...d2);ctx.closePath();ctx.clip();
    ctx.transform(a,b,c,d,d0[0]-a*s0[0]-c*s0[1],d0[1]-b*s0[0]-d*s0[1]);ctx.drawImage(bitmap,0,0);ctx.restore();
  }
}

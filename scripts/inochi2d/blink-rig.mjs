// Source-aligned contour blink for shared parts. Uses only legacy 0.8.6
// mesh/deform/opacity/stencil bindings, never a Cubism-only deformer.
const smooth=x=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
export function sampleTrace(trace,count=25){
  if(!Array.isArray(trace)||trace.length<2||!trace.every(Number.isFinite))throw Error('Finite source eyelid trace required.');
  return Array.from({length:count},(_,i)=>{const u=i/(count-1)*(trace.length-1),a=Math.floor(u),b=Math.min(trace.length-1,a+1);return trace[a]+(trace[b]-trace[a])*(u-a);});
}
function mesh(width,height,trace){
  const verts=[],uvs=[],indices=[],cols=trace.length,rows=7;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const x=col/(cols-1),center=Math.max(1,Math.min(height-1,trace[col]));
    const y=row<3?center*[0,.35,.75][row]:row===3?center:center+(height-center)*[.25,.65,1][row-4];
    verts.push((x-.5)*width,y-height/2);uvs.push(x,y/height);
  }
  for(let r=0;r<rows-1;r++)for(let c=0;c<cols-1;c++){const a=r*cols+c,b=a+1,d=a+cols;indices.push(a,b,d,b,d+1,d);}
  return {verts,uvs,indices,origin:[0,0]};
}
const binding=(node,param_name,values)=>({node:node.uuid,param_name,values:values.map(v=>[v]),isSet:values.map(()=>[true]),interpolate_mode:'Linear'});

export function applyContourBlink(model,graph){
  const nodes=new Map();const visit=n=>{nodes.set(n.name,n);for(const c of n.children)visit(c);};visit(model.nodes);
  const axis=[0,.025,.05,.075,.1,.15,.25,.5,.75,1];
  for(const side of ['l','r']){
    const g=graph.motions.blink[side],p=model.param.find(p=>p.name==='EyeOpen'+side.toUpperCase());
    const [, ,w,h]=g.box_xywh,upper=nodes.get('eye_lash_'+side),closed=nodes.get('eye_closed_'+side),eye=nodes.get('eye_white_'+side),aperture=nodes.get('EyeAperture:'+side),lower=nodes.get('eye_lash_lower_'+side);
    const source=sampleTrace(g.upper_center_y),shut=sampleTrace(g.closed_center_y),bottom=sampleTrace(g.lower_center_y);
    const sourceWidth=Math.max(1,g.source_lash_width),closedWidth=Math.max(.5,g.closed_lash_width);
    upper.mesh=mesh(w,h,source);closed.mesh=mesh(w,h,shut);aperture.mesh=mesh(w,h,Array(25).fill(h/2));
    // Normal source-over with two complementary .5 opacities has only .75
    // coverage and mixes skin into the lash. Keep a dark contour core below
    // the source ink until that ink covers it, then retire the estimate.
    closed.zsort=upper.zsort+.25;
    if(lower)lower.mesh=mesh(w,h,bottom);
    const curve=v=>source.map((y,i)=>shut[i]+(y-shut[i])*v);
    const deform=(node,fn)=>node.mesh.uvs.reduce((out,x,i,uv)=>{if(i%2===0){const col=Math.round(x*24),y=uv[i+1]*h;out.push([0,fn(col,y)-y]);}return out;},[]);
    const sourceOpacity=v=>smooth((v-.25)/.5);
    p.axis_points=[axis,[0]];
    p.bindings=[
      binding(eye,'opacity',axis.map(v=>v===0?0:1)),
      binding(upper,'opacity',axis.map(sourceOpacity)),
      binding(closed,'opacity',axis.map(v=>1-smooth((v-.7)/.3))),
      binding(upper,'deform',axis.map(v=>{const target=curve(v),width=closedWidth+(sourceWidth-closedWidth)*v;return deform(upper,(i,y)=>target[i]+(y-source[i])*width/sourceWidth);})),
      binding(closed,'deform',axis.map(v=>{const target=curve(v),width=closedWidth+(sourceWidth-closedWidth)*v;return deform(closed,(i,y)=>target[i]+(y-shut[i])*width/closedWidth);})),
      binding(aperture,'deform',axis.map(v=>{
        if(v===1)return deform(aperture,(_,y)=>y);
        const top=curve(v),width=closedWidth+(sourceWidth-closedWidth)*v;
        return deform(aperture,(i,y)=>{
          const a=top[i]+width*.12*v,b=Math.max(a,shut[i]+(bottom[i]-shut[i])*v);
          return a+(b-a)*y/h;
        });
      })),
    ];
    if(lower){
      p.bindings.push(binding(lower,'opacity',axis.map(v=>smooth((v-.25)/.5))));
      p.bindings.push(binding(lower,'deform',axis.map(v=>deform(lower,(i,y)=>y+(shut[i]-bottom[i])*(1-v)))));
    }
  }
  return {profile:'contour-lid-v2',axis,columns:25,rows:7,
    commonUpperClosedCurve:true,sourceAndClosedStrokeCrossfadeBegins:.25,
    opaqueStrokeCoreDuringTransition:true,estimatedStrokeBelowSource:true,
    observedLidSkinInBase:true,sourceTextureResampled:false,
    uses:['legacy mesh','deform bindings','opacity bindings','stencil mask'],
    naturalnessVerified:false};
}

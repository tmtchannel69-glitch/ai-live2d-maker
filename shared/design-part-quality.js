// Observable pixel measurements. None identifies hair, diagnoses an art style,
// or proves that an occluded surface was correctly painted.
const round=n=>Number(n.toFixed(5));
const luma=(r,g,b)=>(.2126*r+.7152*g+.0722*b)/255;
function lab([r,g,b]){
  const c=[r,g,b].map(n=>{n/=255;return n>.04045?((n+.055)/1.055)**2.4:n/12.92;});
  const xyz=[(.4124564*c[0]+.3575761*c[1]+.1804375*c[2])/.95047,.2126729*c[0]+.7151522*c[1]+.072175*c[2],(.0193339*c[0]+.119192*c[1]+.9503041*c[2])/1.08883].map(n=>n>.008856?Math.cbrt(n):7.787*n+16/116);
  return [116*xyz[1]-16,500*(xyz[0]-xyz[1]),200*(xyz[1]-xyz[2])];
}
export function paletteDistance(a,b){
  if(!a.length||!b.length)return null;
  const target=b.map(v=>lab(v.rgb));let sum=0,count=0;
  for(const p of a){const color=lab(p.rgb);sum+=Math.min(...target.map(t=>Math.hypot(...color.map((n,i)=>n-t[i]))))*p.samples;count+=p.samples;}
  return round(sum/count);
}
export function measureDesignPixels({data,width,height}, {anchor=null}={}){
  if(!(data instanceof Uint8Array||data instanceof Uint8ClampedArray)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1024||height>1024||data.length!==width*height*4)throw new Error('品質検査のRGBA寸法が正しくありません。');
  let visible=0,strong=0,weak=0,edge=0,opaque=0,soft=0,dark=0,shadingN=0,sum=0,sum2=0,minX=width,minY=height,maxX=-1,maxY=-1;
  const bins=new Map(),ink=new Uint8Array(width*height),runs=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,a=data[i+3];if(!a)continue;visible++;if(a<8){weak++;continue;}
    strong++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    if(x===0||y===0||x===width-1||y===height-1)edge++;
    if(a<240)soft++;else{
      opaque++;const rgb=[data[i],data[i+1],data[i+2]],v=luma(...rgb);
      if(v<.32){dark++;ink[y*width+x]=1;}
      else {const key=rgb.map(n=>Math.floor(n/24)).join(',');let b=bins.get(key);if(!b){b={samples:0,sum:[0,0,0]};bins.set(key,b);}b.samples++;rgb.forEach((n,j)=>b.sum[j]+=n);shadingN++;sum+=v;sum2+=v*v;}
    }
  }
  // Width of short dark runs in two directions is a *proxy*, not a measured
  // artist's stroke width. Dark hair/eyes/cloth deliberately make it unknown.
  if(opaque&&dark/opaque<.35){
    for(let y=0;y<height;y+=2){let run=0;for(let x=0;x<=width;x++){if(x<width&&ink[y*width+x])run++;else{if(run&&run<=16)runs.push(run);run=0;}}}
    for(let x=0;x<width;x+=2){let run=0;for(let y=0;y<=height;y++){if(y<height&&ink[y*width+x])run++;else{if(run&&run<=16)runs.push(run);run=0;}}}
  }
  runs.sort((a,b)=>a-b);let anchorSamples=0,anchorOpaque=0;
  if(anchor)for(let y=Math.max(0,Math.round(anchor[1])-8);y<Math.min(height,Math.round(anchor[1])+9);y++)for(let x=Math.max(0,Math.round(anchor[0])-8);x<Math.min(width,Math.round(anchor[0])+9);x++){
    anchorSamples++;if(data[(y*width+x)*4+3]>=240)anchorOpaque++;
  }
  const palette=[...bins.values()].sort((a,b)=>b.samples-a.samples).slice(0,7).map(b=>({rgb:b.sum.map(n=>Math.round(n/b.samples)),samples:b.samples}));
  return {size:[width,height],visible_pixels:visible,strong_pixels:strong,faint_pixels:weak,edge_strong_pixels:edge,
    visible_bounds:strong?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null,
    strong_pixel_ratio:round(strong/(width*height)),soft_pixel_ratio:round(strong?soft/strong:0),opaque_pixels:opaque,
    palette,ink_run_proxy_px:runs.length>=16?runs[Math.floor(runs.length/2)]:null,ink_run_samples:runs.length,
    material_luma_std:shadingN>=64?round(Math.sqrt(Math.max(0,sum2/shadingN-(sum/shadingN)**2))):null,
    material_samples:shadingN,anchor_patch:{samples:anchorSamples,opaque_ratio:anchorSamples?round(anchorOpaque/anchorSamples):null},
    semantic_segmentation_performed:false,hidden_surfaces_verified:false};
}
export function compareDesignMeasurements(part,reference,{policy,isHair=false}={}){
  const warnings=[],unknown=['lighting-direction','hidden-surfaces','semantic-boundaries','line-style','shading-style'];
  const target=policy.hair_palette.length&&isHair?policy.hair_palette.map(c=>({rgb:[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)),samples:1})):reference.palette;
  const delta=paletteDistance(part.palette,target);
  if(delta!==null&&delta>20)warnings.push('palette-difference-candidate');
  const expected=policy.line_width_px??reference.ink_run_proxy_px;
  const lineRatio=expected&&part.ink_run_proxy_px?round(part.ink_run_proxy_px/expected):null;
  if(lineRatio!==null&&(lineRatio>2||lineRatio<.5))warnings.push('line-width-difference-candidate');
  const s=part.material_luma_std,t=reference.material_luma_std,shadeRatio=s!==null&&t!==null?round((s+.01)/(t+.01)):null;
  if(shadeRatio!==null&&(shadeRatio>2||shadeRatio<.5)&&Math.abs(s-t)>.025)warnings.push('shading-contrast-difference-candidate');
  if(part.faint_pixels>Math.max(20,part.strong_pixels*.01))warnings.push('faint-alpha-residue-candidate');
  if(part.edge_strong_pixels>Math.max(8,2*(part.size[0]+part.size[1])*.1))warnings.push('clipped-boundary-candidate');
  if(isHair&&part.anchor_patch.opaque_ratio!==null&&part.anchor_patch.opaque_ratio<.75)warnings.push('attachment-patch-thin-candidate');
  return {palette_delta_e76:delta,palette_target:policy.hair_palette.length&&isHair?'owner-declared-hair-colors':'reference-placement-proxy',
    ink_run_ratio:lineRatio,shading_contrast_ratio:shadeRatio,warning_codes:warnings,unverified:unknown,
    appearance_quality_passed:false,style_consistency_verified:false,hidden_surfaces_verified:false};
}

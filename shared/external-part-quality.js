// Deterministic pixel heuristics for local user-supplied PNGs.
// Warnings flag images to inspect; they are NOT semantic/art-quality judgments.
const need=(value,message)=>{if(!value)throw new Error(message);};
const ratio=(numerator,denominator)=>denominator?Math.round((numerator/denominator)*10000)/10000:0;

export function inspectExternalPartPixels(pixels,canvasWidth,canvasHeight,rect){
  need(pixels instanceof Uint8ClampedArray||pixels instanceof Uint8Array,'Expected RGBA pixels');
  need(Number.isInteger(canvasWidth)&&Number.isInteger(canvasHeight)&&canvasWidth>0&&canvasHeight>0&&
    canvasWidth<=1024&&canvasHeight<=1024&&pixels.length===canvasWidth*canvasHeight*4,
    'Invalid decoded RGBA canvas dimensions');
  need(rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)&&
    rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0&&
    rect.x+rect.width<=canvasWidth&&rect.y+rect.height<=canvasHeight,
    'Part rectangle must fit the canvas');
  let visible=0,transparent=0,semiTransparent=0,outsideVisible=0,edgeVisible=0;
  let minX=rect.width,minY=rect.height,maxX=-1,maxY=-1;
  for(let y=0;y<canvasHeight;y++)for(let x=0;x<canvasWidth;x++){
    const alpha=pixels[(y*canvasWidth+x)*4+3];
    const inside=x>=rect.x&&x<rect.x+rect.width&&y>=rect.y&&y<rect.y+rect.height;
    if(!inside){if(alpha!==0)outsideVisible++;continue;}
    if(alpha===0){transparent++;continue;}
    visible++;if(alpha<255)semiTransparent++;
    const localX=x-rect.x,localY=y-rect.y;
    minX=Math.min(minX,localX);maxX=Math.max(maxX,localX);
    minY=Math.min(minY,localY);maxY=Math.max(maxY,localY);
    if(localX===0||localY===0||localX===rect.width-1||localY===rect.height-1)edgeVisible++;
  }
  const area=rect.width*rect.height;
  const border=area===1?1:rect.width===1?rect.height:rect.height===1?rect.width:2*(rect.width+rect.height)-4;
  const visibleRatio=ratio(visible,area),edgeCoverage=ratio(edgeVisible,border),warnings=[];
  if(visibleRatio<0.01)warnings.push('very-low-coverage');
  if(visibleRatio>0.98)warnings.push('almost-opaque-tile');
  if(edgeCoverage>0.55)warnings.push('high-edge-contact');
  return {format:'ai-live2d-external-part-pixel-diagnostics',version:1,
    rect_size:[rect.width,rect.height],visible_pixels:visible,transparent_pixels:transparent,
    semi_transparent_pixels:semiTransparent,outside_visible_pixels:outsideVisible,
    visible_ratio:visibleRatio,edge_visible_pixels:edgeVisible,edge_coverage_ratio:edgeCoverage,
    visible_bounds:visible?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null,
    warning_codes:warnings,warning_count:warnings.length,appearance_quality_verified:false,
    note:'Pixel-only warning thresholds; never proves character consistency, hidden anatomy, identity, real AI generation, or Cubism compatibility.'};
}

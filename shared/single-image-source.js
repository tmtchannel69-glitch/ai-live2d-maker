// Offline intake contract for ONE portrait image. Regions are only inspection
// windows on a finished composite, never independent Live2D/Inochi layers.
export const SOURCE_CANVAS=Object.freeze({width:768,height:1024});
export const SOURCE_MAX_BYTES=8*1024*1024;
const need=(v,msg)=>{if(!v)throw new Error(msg);};
const num=n=>Math.round(n*10000)/10000;
export function planPortraitNormalization(width,height){
  need(Number.isInteger(width)&&Number.isInteger(height)&&width>=128&&height>=128&&
    width<=4096&&height<=4096&&width*height<=16_000_000,'画像は128〜4096px、最大1600万画素で指定してください。');
  const scale=Math.min(SOURCE_CANVAS.width/width,SOURCE_CANVAS.height/height);
  const renderedWidth=Math.max(1,Math.round(width*scale));
  const renderedHeight=Math.max(1,Math.round(height*scale));
  return {source_size:[width,height],canvas_size:[SOURCE_CANVAS.width,SOURCE_CANVAS.height],
    fit:'contain',scale:num(scale),draw_rect:{
      x:Math.floor((SOURCE_CANVAS.width-renderedWidth)/2),
      y:Math.floor((SOURCE_CANVAS.height-renderedHeight)/2),
      width:renderedWidth,height:renderedHeight
    },auto_subject_alignment:false,subject_landmarks_detected:false};
}
export function auditPortraitPixels(pixels,parts,{drawRect}={}){
  const {width,height}=SOURCE_CANVAS;
  need(pixels instanceof Uint8ClampedArray&&pixels.length===width*height*4,'基準画像のRGBA画素が不正です。');
  need(Array.isArray(parts)&&parts.length===33&&new Set(parts.map(p=>p.role)).size===33,
    '33パーツの基準配置が必要です。');
  let transparent=0,semi=0,visible=0,minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const alpha=pixels[(y*width+x)*4+3];
    if(alpha===0)transparent++;else {
      visible++;if(alpha<255)semi++;
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    }
  }
  const bbox=visible?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null;
  const roles=[];
  for(const p of parts){
    const r=p.rect;
    need(r&&[r.x,r.y,r.width,r.height].every(Number.isInteger)&&r.width>0&&r.height>0&&
      r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height,
      '基準パーツの座標が不正です: '+p.role);
    let nonTransparent=0;
    for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++)
      if(pixels[(y*width+x)*4+3]>0)nonTransparent++;
    const area=r.width*r.height,ratio=num(nonTransparent/area);
    const warnings=[];
    if(ratio===0)warnings.push('empty-region');
    if(ratio===1)warnings.push('opaque-region-no-layer-separation');
    roles.push({role:p.role,label:p.label,rect:{...r},visible_fraction:ratio,
      role_contents_isolated:false,original_hidden_pixels_recovered:false,
      warning_codes:warnings});
  }
  const coverage=num(visible/(width*height)),warnings=[];
  if(visible===0)warnings.push('empty-source');
  if(transparent===0)warnings.push('opaque-background-needs-separation');
  if(bbox&&(bbox.x===0||bbox.y===0||bbox.x+bbox.width===width||bbox.y+bbox.height===height))
    warnings.push('foreground-touches-canvas-edge');
  if(drawRect&&[drawRect.x,drawRect.y,drawRect.width,drawRect.height].every(Number.isFinite)&&
    (drawRect.x!==0||drawRect.y!==0||drawRect.width!==width||drawRect.height!==height))
    warnings.push('source-letterboxed-no-subject-alignment');
  // No semantic detection is performed, even if a template box contains pixels.
  return {format:'ai-live2d-single-portrait-audit',version:1,
    canvas_size:[width,height],visible_fraction:coverage,
    transparent_fraction:num(transparent/(width*height)),
    semi_transparent_fraction:num(semi/(width*height)),
    foreground_bbox:bbox,role_windows:roles,roles_checked:33,warning_codes:warnings,
    input_images:1,independent_parts_generated:0,hidden_surfaces_recovered:0,
    automatic_segmentation_performed:false,subject_landmarks_detected:false,
    rigging_performed:false,ai_generation_performed:false,appearance_quality_verified:false,
    safe_next_step:'Use a subject-aware segmentation and hidden-surface completion provider before trying the 33-part model.',
    note:'33 rectangles sample regions from ONE already-composited image. They are not layer masks or completed parts.'};
}

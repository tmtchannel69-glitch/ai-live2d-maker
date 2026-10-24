// Structural pixel checks only: no semantic AI/style/hidden-anatomy verdict.
import {decode,encode} from 'fast-png';
import {createHash} from 'node:crypto';

export function inspectPilotPart(request,png){
  if(request.operation!=='edit'||!request.part||request.api_rect?.width!==request.part.rect.width)throw new Error('A validated pilot part request is required.');
  if(!(png instanceof Uint8Array)||png.length<33||png.length>8*1024*1024)throw new Error('Part PNG must be a nonempty file of at most 8MiB.');
  const header=new DataView(png.buffer,png.byteOffset,png.byteLength);
  if(header.getUint32(0)!==0x89504e47||header.getUint32(4)!==0x0d0a1a0a||header.getUint32(12)!==0x49484452||header.getUint32(16)!==1024||header.getUint32(20)!==1024||png[24]!==8||png[25]!==6)throw new Error('Expected exactly 1024x1024, 8-bit RGBA PNG before decoding.');
  const image=decode(png);if(image.channels!==4||image.depth!==8)throw new Error('Independent layers require 8-bit RGBA.');
  const q=request.api_rect,tile=new Uint8Array(q.width*q.height*4);let visible=0,outside=0,transparent=0,transparentInTile=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const i=(y*image.width+x)*4,inside=x>=q.x&&x<q.x+q.width&&y>=q.y&&y<q.y+q.height;
    if(image.data[i+3]===0){transparent++;if(inside)transparentInTile++;}else if(inside)visible++;else outside++;
    if(inside)tile.set(image.data.subarray(i,i+4),((y-q.y)*q.width+x-q.x)*4);
  }
  const passed=visible>0&&transparentInTile>0&&outside===0;
  return {report:{format:'ai-live2d-pilot-part-structure',version:1,role:request.role,
    source_sha256:createHash('sha256').update(png).digest('hex'),source_canvas:[image.width,image.height],
    canonical_rect:request.part.rect,anchor:request.part.anchor,parent:request.part.parent,order:request.part.order,
    visible_pixels_in_tile:visible,visible_pixels_outside_tile:outside,fully_transparent_pixels:transparent,fully_transparent_pixels_in_tile:transparentInTile,
    structure_passed:passed,ai_provenance_verified:false,hidden_surface_quality_verified:false,color_line_consistency_verified:false,
    appearance_quality_passed:false,official_creator_tested:false,
    limitation:'A nonempty PNG inside its allowed rectangle can still be a bad part, a painted checkerboard or guide artwork. Structural checks do not verify semantic content, genuine AI provenance, identity or hidden surfaces.'},
    // Preserve all RGBA, including alpha and RGB in transparent pixels. Do not
    // resize, erase overflow or substitute missing artwork to make tests pass.
    tile_png:passed?encode({width:q.width,height:q.height,channels:4,depth:8,data:tile}):null};
}

// Technical geometry guides, not character artwork or AI-generated parts.
import {encode} from 'fast-png';
import {API_CANVAS,API_OFFSET} from './plan.mjs';

export function createGuidePng(part){
  const {width,height}=API_CANVAS,data=new Uint8Array(width*height*4),q=part.rect;
  const put=(x,y,color)=>{x=Math.round(x);y=Math.round(y);if(x<0||x>=width||y<0||y>=height)return;data.set(color,(y*width+x)*4);};
  const x=q.x+API_OFFSET.x,y=q.y;
  for(let i=x;i<x+q.width;i++){put(i,y,[0,170,255,255]);put(i,y+q.height-1,[0,170,255,255]);}
  for(let j=y;j<y+q.height;j++){put(x,j,[0,170,255,255]);put(x+q.width-1,j,[0,170,255,255]);}
  const [ax,ay]=part.anchor;
  for(let i=-6;i<=6;i++){put(ax+API_OFFSET.x+i,ay,[255,0,170,255]);put(ax+API_OFFSET.x,ay+i,[255,0,170,255]);}
  return encode({width,height,channels:4,depth:8,data});
}

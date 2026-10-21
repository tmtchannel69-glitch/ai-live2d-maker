// Preserve the existing nearest-neighbor placement unless an axis shrinks.
// Shrinking uses a separable box filter over premultiplied RGBA. Process a
// shrinking axis first, so work is O(source pixels + destination pixels), even
// when the other axis enlarges. Two scanlines are reused; no full float image.
// The destination is a newly cleared RGBA canvas, not an existing composite.
const CHANNELS=4,FLOAT_BYTES=8;
function geometry(sourceWidth,sourceHeight,width,height,p){
  if(![sourceWidth,sourceHeight,width,height].every(n=>Number.isInteger(n) && n>0 && n<=4096) || !p || ![p.x,p.y].every(n=>Number.isFinite(n) && n>=0 && n<=1) || ![p.width,p.height].every(n=>Number.isFinite(n) && n>=.0001 && n<=1))throw new Error('素材の配置が正しくありません。');
  const spanX=p.width*width,spanY=p.height*height;
  // Tolerate multiplication roundoff for an exact one-to-one placement.
  const shrinkX=spanX<sourceWidth-sourceWidth*1e-12,shrinkY=spanY<sourceHeight-sourceHeight*1e-12;
  return {spanX,spanY,shrink:shrinkX||shrinkY,horizontalFirst:shrinkX,
    x0:Math.max(0,Math.floor(p.x*width)),x1:Math.min(width,Math.ceil((p.x+p.width)*width)),
    y0:Math.max(0,Math.floor(p.y*height)),y1:Math.min(height,Math.ceil((p.y+p.height)*height))};
}
export function placementScratchBytes(sourceWidth,sourceHeight,width,height,p){
  const g=geometry(sourceWidth,sourceHeight,width,height,p);
  return g.shrink && g.x1>g.x0 && g.y1>g.y0?(g.horizontalFirst?g.x1-g.x0:g.y1-g.y0)*CHANNELS*FLOAT_BYTES*2:0;
}
export function placeModelPixels({input,sourceWidth,sourceHeight,width,height,placement:p,data}){
  const g=geometry(sourceWidth,sourceHeight,width,height,p);
  if(!(input instanceof Uint8Array || input instanceof Uint8ClampedArray) || input.length!==sourceWidth*sourceHeight*4 || !(data instanceof Uint8ClampedArray) || data.length!==width*height*4)throw new Error('素材の画素量が正しくありません。');
  if(!g.shrink){
    // Retain exact legacy samples/placement for native-size AI and enlargement.
    for(let y=g.y0;y<g.y1;y++)for(let x=g.x0;x<g.x1;x++){
      const sx=Math.min(sourceWidth-1,Math.max(0,Math.floor((x-p.x*width)/g.spanX*sourceWidth))),sy=Math.min(sourceHeight-1,Math.max(0,Math.floor((y-p.y*height)/g.spanY*sourceHeight))),i=(sy*sourceWidth+sx)*4;
      if(input[i+3]>0)data.set(input.subarray(i,i+4),(y*width+x)*4);
    }
    return;
  }
  if(g.x1<=g.x0 || g.y1<=g.y0)return;
  const horizontal=g.horizontalFirst,firstSource=horizontal?sourceWidth:sourceHeight,secondSource=horizontal?sourceHeight:sourceWidth;
  const firstStart=horizontal?g.x0:g.y0,firstEnd=horizontal?g.x1:g.y1,secondStart=horizontal?g.y0:g.x0,secondEnd=horizontal?g.y1:g.x1;
  const firstOffset=horizontal?p.x*width:p.y*height,secondOffset=horizontal?p.y*height:p.x*width;
  const firstFootprint=firstSource/(horizontal?g.spanX:g.spanY),secondFootprint=secondSource/(horizontal?g.spanY:g.spanX);
  const count=firstEnd-firstStart,row=new Float64Array(count*4),sum=new Float64Array(count*4);let cached=-1;
  function filterFirst(sourceSecond){
    row.fill(0);
    for(let d=firstStart;d<firstEnd;d++){
      const lo=Math.max(0,(d-firstOffset)*firstFootprint),hi=Math.min(firstSource,(d+1-firstOffset)*firstFootprint),j=(d-firstStart)*4;
      for(let s=Math.floor(lo);s<Math.ceil(hi);s++){
        const weight=Math.min(hi,s+1)-Math.max(lo,s);if(weight<=0)continue;
        const i=horizontal?(sourceSecond*sourceWidth+s)*4:(s*sourceWidth+sourceSecond)*4,a=input[i+3];if(!a)continue;
        row[j]+=input[i]*a*weight;row[j+1]+=input[i+1]*a*weight;row[j+2]+=input[i+2]*a*weight;row[j+3]+=a*weight;
      }
      for(let c=0;c<4;c++)row[j+c]/=firstFootprint;
    }
    cached=sourceSecond;
  }
  for(let d=secondStart;d<secondEnd;d++){
    sum.fill(0);
    const lo=Math.max(0,(d-secondOffset)*secondFootprint),hi=Math.min(secondSource,(d+1-secondOffset)*secondFootprint);
    for(let s=Math.floor(lo);s<Math.ceil(hi);s++){
      const weight=Math.min(hi,s+1)-Math.max(lo,s);if(weight<=0)continue;
      if(cached!==s)filterFirst(s);
      for(let k=0;k<sum.length;k++)sum[k]+=row[k]*weight;
    }
    for(let f=0;f<count;f++){
      const j=f*4,i=horizontal?(d*width+firstStart+f)*4:((firstStart+f)*width+d)*4,a=Math.min(255,Math.round(sum[j+3]/secondFootprint));
      if(a>0){for(let c=0;c<3;c++)data[i+c]=Math.round(sum[j+c]/sum[j+3]);data[i+3]=a;}
    }
  }
}

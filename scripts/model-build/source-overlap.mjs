// A preparation hint only. Equal pixels are evidence of overlap, not proof of
// an incorrectly drawn face or a natural/unnatural expression.
export function findFaceFeatureOverlap(children){
  const base=children.find(c=>c.name==='face')?.imageData?.data;if(!base)return [];
  const result=[];
  for(const c of children){
    if(!/^(eye|irides|mouth)/.test(c.name))continue;
    const data=c.imageData?.data;if(!data || data.length!==base.length)continue;
    let visiblePixels=0,sameColorPixels=0;
    for(let i=0;i<data.length;i+=4)if(data[i+3]>=16){visiblePixels++;if(base[i+3]>=16 && data[i]===base[i] && data[i+1]===base[i+1] && data[i+2]===base[i+2])sameColorPixels++;}
    if(visiblePixels>=16 && sameColorPixels/visiblePixels>=.5)result.push({layer:c.name,visiblePixels,sameColorPixels,ratio:Math.round(sameColorPixels/visiblePixels*10000)/10000});
  }
  return result;
}

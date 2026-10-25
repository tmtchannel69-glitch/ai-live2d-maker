// Geometric region proposals on a single foreground silhouette.
// A horizontal neck-like narrowing is NOT semantic anatomy detection.
// Nothing from this module may be treated as an independent 2D rig layer.
const W=768,H=1024,SIZE=W*H;
const requireValid=(v,msg)=>{if(!v)throw new Error(msg);};
const frac=(a,b)=>b?Math.round(a/b*10000)/10000:0;
const bounds=(p)=>p&&p.count?{x:p.minX,y:p.minY,width:p.maxX-p.minX+1,height:p.maxY-p.minY+1}:null;

export function proposePortraitRegions(mask){
  requireValid(mask instanceof Uint8Array&&mask.length===SIZE,
    '768×1024の前景マスクが必要です。');
  const labels=new Int32Array(SIZE),queue=new Uint32Array(SIZE),components=[];
  let total=0;
  for(let i=0;i<SIZE;i++)if(mask[i]>32)total++;
  requireValid(total>=Math.ceil(SIZE*.01),'前景の可視領域が少なすぎます。');
  let id=0;
  for(let start=0;start<SIZE;start++){
    if(mask[start]<=32||labels[start])continue;
    id++;
    requireValid(id<=10000,'孤立した小領域が多すぎます。');
    let head=0,tail=1;queue[0]=start;labels[start]=id;
    const p={id,count:0,minX:W,minY:H,maxX:-1,maxY:-1};
    while(head<tail){
      const k=queue[head++],x=k%W,y=(k/W)|0;
      p.count++;p.minX=Math.min(x,p.minX);p.maxX=Math.max(x,p.maxX);
      p.minY=Math.min(y,p.minY);p.maxY=Math.max(y,p.maxY);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=W||ny<0||ny>=H)continue;
        const next=ny*W+nx;
        if(labels[next]||mask[next]<=32)continue;
        labels[next]=id;queue[tail++]=next;
      }
    }
    components.push(p);
  }
  components.sort((a,b)=>b.count-a.count);
  const primary=components[0],primaryShare=frac(primary.count,total);
  const overall={component_count:components.length,main_component_fraction:primaryShare,
    total_foreground_pixels:total,main_bounds:bounds(primary)};
  const warnings=[],noProposal=reason=>({
    format:'ai-live2d-portrait-region-proposals',version:1,
    method:'connected-silhouette-neck-heuristic',status:'ambiguous',reason,
    ...overall,split_y:null,upper_candidate:null,lower_candidate:null,
    warning_codes:[...warnings,reason],geometry_only:true,
    landmarks_detected:false,anatomical_segmentation_performed:false,
    independent_parts_generated:0,hidden_surfaces_recovered:0,
    rigging_performed:false,appearance_quality_verified:false
  });
  if(components.length>1)warnings.push('disconnected-islands-present');
  if(primaryShare<.85)return noProposal('multiple-significant-components');
  const rect=bounds(primary);
  if(rect.height<160||rect.width<48||rect.height<rect.width*.92)return noProposal('unsupported-silhouette-proportions');
  const rowMin=new Int32Array(H).fill(W),rowMax=new Int32Array(H).fill(-1),rowCount=new Int32Array(H);
  for(let k=0;k<SIZE;k++)if(labels[k]===primary.id){
    const x=k%W,y=(k/W)|0;rowCount[y]++;
    rowMin[y]=Math.min(rowMin[y],x);rowMax[y]=Math.max(rowMax[y],x);
  }
  const width=y=>rowCount[y]?rowMax[y]-rowMin[y]+1:0;
  const smooth=y=>{
    let sum=0,n=0;
    for(let j=Math.max(rect.y,y-3);j<=Math.min(rect.y+rect.height-1,y+3);j++){
      if(rowCount[j]){sum+=width(j);n++;}
    }
    return n?sum/n:0;
  };
  const from=p=>rect.y+Math.floor(rect.height*p);
  const upperPeak=Math.max(...Array.from({length:Math.max(1,from(.34)-from(.08))},(_,i)=>smooth(from(.08)+i)));
  const lowerPeak=Math.max(...Array.from({length:Math.max(1,from(.92)-from(.57))},(_,i)=>smooth(from(.57)+i)));
  if(!upperPeak||!lowerPeak)return noProposal('insufficient-shape-profile');
  let splitY=-1,narrowest=Infinity;
  for(let y=from(.30);y<from(.65);y++){
    const candidate=smooth(y);
    if(candidate&&candidate<narrowest){narrowest=candidate;splitY=y;}
  }
  if(splitY<0||narrowest/upperPeak>.7||narrowest/lowerPeak>.7||upperPeak<lowerPeak*.23)
    return noProposal('no-clear-neck-narrowing');
  const top={count:0,minX:W,minY:H,maxX:-1,maxY:-1};
  const bottom={count:0,minX:W,minY:H,maxX:-1,maxY:-1};
  for(let k=0;k<SIZE;k++)if(labels[k]===primary.id){
    const x=k%W,y=(k/W)|0,t=y<splitY?top:bottom;
    t.count++;t.minX=Math.min(t.minX,x);t.maxX=Math.max(t.maxX,x);
    t.minY=Math.min(t.minY,y);t.maxY=Math.max(t.maxY,y);
  }
  if(top.count<primary.count*.08||bottom.count<primary.count*.16)
    return noProposal('unbalanced-upper-lower-regions');
  warnings.push('hair-or-clothing-may-cross-boundary','not-anatomically-validated');
  return {format:'ai-live2d-portrait-region-proposals',version:1,
    method:'connected-silhouette-neck-heuristic',status:'candidate',reason:null,
    ...overall,split_y:splitY,
    upper_candidate:{rect:bounds(top),pixels:top.count,source:'main-silhouette-above-split'},
    lower_candidate:{rect:bounds(bottom),pixels:bottom.count,source:'main-silhouette-below-split'},
    neck_width_ratio:frac(narrowest,Math.min(upperPeak,lowerPeak)),
    warning_codes:warnings,geometry_only:true,landmarks_detected:false,
    anatomical_segmentation_performed:false,independent_parts_generated:0,
    hidden_surfaces_recovered:0,rigging_performed:false,appearance_quality_verified:false,
    note:'Only a geometric proposal. May mislabel hair, raised arms, full-body art, accessories and clothing.'
  };
}

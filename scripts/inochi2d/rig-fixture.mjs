export function headFixture(){
  const image=(width,height)=>({width,height,data:new Uint8Array(width*height*4)});
  const images={},parts=[],base=image(100,120),skin=image(100,120),blink={};
  for(let i=0;i<base.data.length;i+=4)base.data.set([245,210,190,255],i);
  base.data.set([100,80,60,128],(100*100+50)*4);
  const add=(id,role,im,box,side=null,completion=false)=>{
    const path=(completion?'completion/':'observed/')+id+'.png';images[path]=im;
    parts.push({id,role,side,source_box_xywh:box,observed:{rgba:completion?null:path},completion:{rgba:completion?path:null}});
  };
  for(const [index,side] of ['l','r'].entries()){
    const x=index?28:58,y=28,w=12,h=16,box=[x,y,w,h];
    const bands=Object.fromEntries(['sclera','iris','eyelash_upper','eyelash_lower'].map(r=>[r,image(w,h)]));
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const role=j<3?'eyelash_upper':j===h-1?'eyelash_lower':i>3&&i<9?'iris':'sclera';
      const color=role.includes('eyelash')?[40,30,35,255]:role==='iris'?[90,80,170,255]:[250,249,247,255];
      bands[role].data.set(color,(j*w+i)*4);base.data.fill(0,((y+j)*100+x+i)*4,((y+j)*100+x+i+1)*4);
      skin.data.set([245,210,190,255],((y+j)*100+x+i)*4);
    }
    for(const [role,im] of Object.entries(bands))add(`eye_${side}_${role}`,role,im,box,side);
    const closed=image(w,h);for(let i=1;i<w-1;i++)closed.data.set([45,30,35,255],(8*w+i)*4);
    add(`eye_${side}_closed`,'closed_eyelash',closed,box,side,true);
    blink[side]={profile:'contour-lid-v2',box_xywh:box,upper_center_y:Array(25).fill(1.5),
      closed_center_y:Array(25).fill(8),lower_center_y:Array(25).fill(15),source_lash_width:3,closed_lash_width:1};
  }
  for(const [role,y,h] of [['head_surface',0,70],['neck',70,15],['body',85,35]]){
    const im=image(100,h);im.data.set(base.data.subarray(y*100*4,(y+h)*100*4));add(role,role,im,[0,y,100,h]);
  }
  add('eye_skin_underpaint','skin_completion',skin,[0,0,100,120],null,true);
  return {images,graph:{format:'ai-live2d-maker-character-parts',version:1,source:{width:100,height:120},parts,
    motions:{blink,head:{pivot:{x:.5,y:.58},neck_blend:{rigidY:.54,fixedY:.68}},
      independent_head:{profile:'head-neck-body-v1',jaw:{coefficients_normalized_x:[0,0,70],center_x:50,x_scale:60,center_y:70},
        collar_y:85,head_pivot_xy:[50,70],maximum_translation_pixels:1.4,maximum_tilt_radians:.045}}}};
}

// Limited independent Canvas inspection of our generated Normal/mask rig.
// It evaluates the actual serialized bindings; it is not an official SDK.
import {decode} from 'fast-png';
import {readModularContainer} from '../../shared/modular-character-rig.js';
import {validateMakerPose} from '../../shared/modular-character.js';
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
function mix(a,b,t){return Array.isArray(a)?a.map((v,i)=>mix(v,b[i],t)):a+(b-a)*t;}
function evaluate(model,pose){
  const states=new Map();
  const visit=(n,parent=null)=>{if(states.size>=64||states.has(n.uuid))throw new Error('確認用モデルのノードが不正です。');states.set(n.uuid,{node:n,parent,t:n.transform.trans.slice(0,2),angle:n.transform.rot[2],scale:n.transform.scale.slice(0,2),opacity:n.opacity??1,deform:Array.from({length:(n.mesh?.verts.length||0)/2},()=>[0,0])});for(const c of n.children)visit(c,n.uuid);};visit(model.nodes);
  for(const p of model.param){
    const raw=pose[p.name]??p.defaults[0],axis=p.axis_points[0],v=Math.max(axis[0],Math.min(axis.at(-1),(raw-p.min[0])/(p.max[0]-p.min[0])));
    let k=1;while(k<axis.length-1&&axis[k]<v)k++;const t=(v-axis[k-1])/(axis[k]-axis[k-1]);
    for(const b of p.bindings){const s=states.get(b.node),value=mix(b.values[k-1][0],b.values[k][0],t),name=b.param_name;
      if(name==='opacity')s.opacity*=value;
      else if(name==='deform')s.deform=s.deform.map((v,i)=>[v[0]+value[i][0],v[1]+value[i][1]]);
      else if(name.startsWith('transform.t.'))s.t['xy'.indexOf(name.at(-1))]+=value;
      else if(name==='transform.r.z')s.angle+=value;
      else if(name.startsWith('transform.s.'))s.scale['xy'.indexOf(name.at(-1))]*=value;
      else throw new Error('独立描画が対応していない動作です: '+name);
    }
  }
  const world=s=>{if(s.world)return s.world;const co=Math.cos(s.angle),si=Math.sin(s.angle),m=[co*s.scale[0],si*s.scale[0],-si*s.scale[1],co*s.scale[1],...s.t];return s.world=s.parent!==null?multiply(world(states.get(s.parent)),m):m;};
  for(const s of states.values())world(s);return states;
}

// The isolated additive triangle layer uses the existing expression-deform.js
// technique to avoid complementary edge alpha seams between mesh triangles.
function drawMesh(ctx,bitmap,state,width,height){
  const mesh=state.node.mesh,uv=mesh.uvs,world=state.world,sx=width/768,sy=height/1024;
  const dest=[];let rigid=true;
  for(let i=0;i<mesh.verts.length;i+=2){const d=state.deform[i/2];if(d[0]||d[1])rigid=false;const p=point(world,mesh.verts[i]+d[0],mesh.verts[i+1]+d[1]);dest.push([(p[0]+384)*sx,(p[1]+512)*sy]);}
  if(rigid){
    const x=mesh.verts[0],y=mesh.verts[1];ctx.save();ctx.setTransform(world[0]*sx,world[1]*sy,world[2]*sx,world[3]*sy,(world[4]+384)*sx,(world[5]+512)*sy);ctx.drawImage(bitmap,x,y);ctx.restore();return;
  }
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(let j=0;j<mesh.indices.length;j+=3){
    const ids=mesh.indices.slice(j,j+3),source=ids.map(i=>[uv[i*2]*bitmap.width,uv[i*2+1]*bitmap.height]),[a,b,c]=ids.map(i=>dest[i]),[s0,s1,s2]=source;
    const ux=s1[0]-s0[0],uy=s1[1]-s0[1],vx=s2[0]-s0[0],vy=s2[1]-s0[1],det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-8||Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-8)continue;
    const dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1],m=[(dx*vy-ex*uy)/det,(dy*vy-ey*uy)/det,(ex*ux-dx*vx)/det,(ey*ux-dy*vx)/det];
    ctx.save();ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.closePath();ctx.clip();ctx.transform(...m,a[0]-m[0]*s0[0]-m[2]*s0[1],a[1]-m[1]*s0[0]-m[3]*s0[1]);ctx.drawImage(bitmap,0,0);ctx.restore();
  }ctx.restore();
}

export async function createMakerPreview(native,{signal}={}){
  const {model,textures}=readModularContainer(native.inp),bitmaps=[];let decoded=0;
  try{
    for(const bytes of textures){
      if(signal?.aborted)throw new DOMException('中止しました。','AbortError');
      const image=decode(bytes);decoded+=image.width*image.height*4;if(decoded>16*1024*1024)throw new Error('確認画像の展開量が上限を超えています。');
      const rgba=new Uint8ClampedArray(image.data);
      for(let i=0;i<rgba.length;i+=4)for(let c=0;c<3;c++)rgba[i+c]=rgba[i+3]?Math.min(255,Math.round(rgba[i+c]*255/rgba[i+3])):0;
      bitmaps.push(await createImageBitmap(new ImageData(rgba,image.width,image.height)));
    }
  }catch(error){bitmaps.forEach(b=>b.close());throw error;}
  const layer=canvas(1,1),scratch=canvas(1,1);let closed=false;
  function render(target,pose){
    if(closed)return;validateMakerPose(pose);
    const width=target.width,height=target.height;if(width>768||height>1024||width<1||height<1)throw new Error('確認キャンバスが範囲外です。');
    for(const c of [layer,scratch]){if(c.width!==width)c.width=width;if(c.height!==height)c.height=height;}
    const output=target.getContext('2d'),paint=layer.getContext('2d'),states=evaluate(model,pose),maskCache=new Map();output.clearRect(0,0,width,height);
    const maskFor=id=>{
      if(maskCache.has(id))return maskCache.get(id);const state=states.get(id),c=canvas(width,height),ctx=c.getContext('2d',{willReadFrequently:true});
      drawMesh(ctx,bitmaps[state.node.textures[0]],state,width,height);const data=ctx.getImageData(0,0,width,height),threshold=state.node.mask_threshold??.5;
      for(let i=0;i<data.data.length;i+=4){const a=data.data[i+3]/255>=threshold?255:0;data.data[i]=data.data[i+1]=data.data[i+2]=255;data.data[i+3]=a;}ctx.putImageData(data,0,0);maskCache.set(id,c);return c;
    };
    const parts=[...states.values()].filter(s=>s.node.type==='Part'&&s.node.enabled!==false).sort((a,b)=>b.node.zsort-a.node.zsort);
    for(const s of parts){
      if(s.opacity<=0)continue;if(s.node.blend_mode!=='Normal')throw new Error('未対応の合成方式です。');
      paint.clearRect(0,0,width,height);drawMesh(paint,bitmaps[s.node.textures[0]],s,width,height);
      if(s.node.masks.length){
        const clip=scratch.getContext('2d');clip.clearRect(0,0,width,height);const normal=s.node.masks.filter(m=>m.mode==='Mask');
        if(!normal.length){clip.fillStyle='white';clip.fillRect(0,0,width,height);}
        for(const m of normal)clip.drawImage(maskFor(m.source),0,0);
        for(const m of s.node.masks.filter(m=>m.mode!=='Mask')){clip.globalCompositeOperation='destination-out';clip.drawImage(maskFor(m.source),0,0);clip.globalCompositeOperation='source-over';}
        paint.globalCompositeOperation='destination-in';paint.drawImage(scratch,0,0);paint.globalCompositeOperation='source-over';
      }
      output.globalAlpha=Math.max(0,Math.min(1,s.opacity));output.drawImage(layer,0,0);output.globalAlpha=1;
    }
    for(const c of maskCache.values())c.width=c.height=0;
  }
  return {render,close(){if(closed)return;closed=true;bitmaps.forEach(b=>b.close());layer.width=layer.height=scratch.width=scratch.height=0;}};
}

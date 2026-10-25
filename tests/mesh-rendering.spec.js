import {test,expect} from '@playwright/test';

test('opaque and translucent meshes have no internal alpha seams or doubled color',async({page})=>{
  await page.goto('/?mode=convert');
  const samples=await page.evaluate(async()=>{
    const {drawDeformed,GRID}=await import('/src/expression-deform.js');
    const result=[];
    for(const alpha of [1,.5])for(const bent of [false,true]){
      const bitmap=document.createElement('canvas');bitmap.width=128;bitmap.height=128;
      const source=bitmap.getContext('2d');source.fillStyle=`rgba(180,60,100,${alpha})`;source.fillRect(0,0,128,128);
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;const ctx=canvas.getContext('2d');
      const points=GRID.map(p=>[...p]);if(bent)points[4]=[.58,.41];
      drawDeformed(ctx,bitmap,{x:.1,y:.1,width:.8,height:.8},points,160,160);
      const pixels=ctx.getImageData(25,25,110,110).data;let min=255,max=0,colorError=0;
      for(let i=0;i<pixels.length;i+=4){min=Math.min(min,pixels[i+3]);max=Math.max(max,pixels[i+3]);colorError=Math.max(colorError,Math.abs(pixels[i]-180),Math.abs(pixels[i+1]-60),Math.abs(pixels[i+2]-100));}
      result.push({alpha,bent,min,max,colorError});
    }
    return result;
  });
  for(const s of samples){const alpha=s.alpha===1?255:128;expect(s.min,JSON.stringify(s)).toBeGreaterThanOrEqual(alpha-2);expect(s.max).toBeLessThanOrEqual(alpha+2);expect(s.colorError).toBeLessThanOrEqual(3);}
});

test('fractional deformations preserve alpha under parent transforms, clipping and layer reuse',async({page})=>{
  await page.goto('/?mode=convert');
  const result=await page.evaluate(async()=>{
    const {drawDeformed,GRID}=await import('/src/expression-deform.js');
    const bitmap=document.createElement('canvas');bitmap.width=128;bitmap.height=128;const source=bitmap.getContext('2d');source.fillStyle='rgba(180,60,100,.5)';source.fillRect(0,0,128,128);
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;const ctx=canvas.getContext('2d');
    let min=255,max=0;
    for(let i=0;i<17;i++){
      ctx.clearRect(0,0,240,240);ctx.save();ctx.beginPath();ctx.rect(35,35,165,165);ctx.clip();ctx.translate(120,120);ctx.rotate(.21);ctx.translate(-120,-120);ctx.globalAlpha=.6;
      const points=GRID.map(p=>[...p]);points[4]=[.43+i*.008,.39+i*.011];
      drawDeformed(ctx,bitmap,{x:.12+i*.0007,y:.1,width:.73,height:.77},points,240,240);ctx.restore();
      const pixels=ctx.getImageData(65,65,95,95).data;for(let j=3;j<pixels.length;j+=4){min=Math.min(min,pixels[j]);max=Math.max(max,pixels[j]);}
    }
    const outside=ctx.getImageData(0,0,30,240).data.filter((_,i)=>i%4===3).some(a=>a>0);
    // Reuse the same destination context for a smaller layer, then a mesh
    // extending beyond its local canvas but moved back into view by a parent.
    ctx.clearRect(0,0,240,240);drawDeformed(ctx,bitmap,{x:.7,y:.7,width:.1,height:.1},GRID,240,240);
    const stale=ctx.getImageData(50,50,1,1).data[3];ctx.clearRect(0,0,240,240);ctx.save();ctx.translate(100,100);
    drawDeformed(ctx,bitmap,{x:-.3,y:-.3,width:.2,height:.2},GRID,240,240);ctx.restore();
    return {min,max,outside,stale,negative:ctx.getImageData(45,45,1,1).data[3],alpha:ctx.globalAlpha,composite:ctx.globalCompositeOperation};
  });
  expect(result.min).toBeGreaterThanOrEqual(74);expect(result.max).toBeLessThanOrEqual(79);expect(result.outside).toBe(false);expect(result.stale).toBe(0);expect(result.negative).toBe(128);expect(result.alpha).toBe(1);expect(result.composite).toBe('source-over');
});

test('identity mapping retains textured pixels and transparent holes across mesh edges',async({page})=>{
  await page.goto('/?mode=convert');
  const result=await page.evaluate(async()=>{
    const {drawDeformed,GRID}=await import('/src/expression-deform.js');
    const bitmap=document.createElement('canvas');bitmap.width=128;bitmap.height=128;const source=bitmap.getContext('2d');
    source.fillStyle='#ba4567';source.fillRect(0,0,128,128);source.fillStyle='rgba(40,120,220,.5)';source.clearRect(20,20,88,88);source.fillRect(20,20,88,88);source.clearRect(50,50,28,28);
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');drawDeformed(ctx,bitmap,{x:0,y:0,width:1,height:1},GRID,128,128);
    const a=source.getImageData(2,2,124,124).data,b=ctx.getImageData(2,2,124,124).data;let error=0,hole=0;
    for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));
    for(const alpha of ctx.getImageData(53,53,22,22).data.filter((_,i)=>i%4===3))hole=Math.max(hole,alpha);
    return {error,hole};
  });
  expect(result.error).toBeLessThanOrEqual(3);expect(result.hole).toBe(0);
});

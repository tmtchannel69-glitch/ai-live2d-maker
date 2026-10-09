const TILE = 64, HISTORY_BYTES = 32 * 1024 * 1024;

// Keep only changed alpha tiles, rather than one full-size image per action.
export function createBrushMask(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let undo = [], redo = [], active = null, limited = false;
  function capture(a, b, radius) {
    const left = Math.max(0, Math.floor((Math.min(a.x,b.x)-radius-2)/TILE)*TILE);
    const top = Math.max(0, Math.floor((Math.min(a.y,b.y)-radius-2)/TILE)*TILE);
    const right = Math.min(canvas.width, Math.ceil(Math.max(a.x,b.x)+radius+2));
    const bottom = Math.min(canvas.height, Math.ceil(Math.max(a.y,b.y)+radius+2));
    for (let y=top;y<bottom;y+=TILE) for (let x=left;x<right;x+=TILE) {
      const key = `${x},${y}`;
      if (active.tiles.has(key)) continue;
      const width=Math.min(TILE,canvas.width-x), height=Math.min(TILE,canvas.height-y);
      const pixels=ctx.getImageData(x,y,width,height).data, alpha=new Uint8Array(width*height);
      for(let i=0;i<alpha.length;i++) alpha[i]=pixels[i*4+3];
      active.tiles.set(key,{x,y,width,height,alpha}); active.bytes+=alpha.byteLength;
    }
  }
  function paint(a,b,stroke) {
    ctx.save(); ctx.globalCompositeOperation=stroke.mode==='erase'?'destination-out':'source-over';
    ctx.fillStyle=ctx.strokeStyle='white'; ctx.lineWidth=stroke.size; ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    ctx.beginPath();ctx.arc(b.x,b.y,stroke.size/2,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function restore(stroke) {
    for(const tile of stroke.tiles.values()) {
      const data=ctx.createImageData(tile.width,tile.height);
      for(let i=0;i<tile.alpha.length;i++) {
        data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=255; data.data[i*4+3]=tile.alpha[i];
      }
      ctx.putImageData(data,tile.x,tile.y);
    }
  }
  return {
    begin(point,mode,size) {
      if(active) return;
      active={mode,size,points:[point],tiles:new Map(),bytes:0};
      capture(point,point,size/2);paint(point,point,active);
    },
    move(point) {
      if(!active) return;
      if(active.points.length>=4096) return false;
      const last=active.points.at(-1);capture(last,point,active.size/2);paint(last,point,active);active.points.push(point);return true;
    },
    finish() {
      if(!active) return;
      redo=[];undo.push(active);active=null;
      let bytes=undo.reduce((sum,s)=>sum+s.bytes,0);
      while(undo.length>100 || bytes>HISTORY_BYTES) {bytes-=undo.shift().bytes;limited=true;}
    },
    cancel() {if(active) restore(active);active=null;},
    undo() {if(active || !undo.length)return;const stroke=undo.pop();restore(stroke);redo.push(stroke);},
    redo() {
      if(active || !redo.length)return;
      const stroke=redo.pop();paint(stroke.points[0],stroke.points[0],stroke);
      for(let i=1;i<stroke.points.length;i++)paint(stroke.points[i-1],stroke.points[i],stroke);
      undo.push(stroke);
    },
    get canUndo(){return undo.length>0;}, get canRedo(){return redo.length>0;},
    get changed(){return undo.length>0 || limited;}, get limited(){return limited;},
    dispose(){undo=[];redo=[];active=null;},
  };
}

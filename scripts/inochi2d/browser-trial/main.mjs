import init,{Preview} from './pkg/inochi_browser_preview.js';
const status=document.querySelector('#status');
try {
 await init();
 const bytes=new Uint8Array(await (await fetch('./minimal.inp')).arrayBuffer());
 const preview=new Preview(bytes,document.querySelector('#canvas'));
 window.preview=preview;window.modelLoaded=true;
 function render(left,right,head){preview.render(left,right,head);for(const [id,val] of [['left',left],['right',right],['head',head]]){document.querySelector('#'+id).value=val;document.querySelector('#'+id+'-value').textContent=val.toFixed(3);}}
 window.setPose=render;render(1,1,0);
 let timer=null;
 for(const id of ['left','right','head'])document.querySelector('#'+id).oninput=()=>{clearInterval(timer);timer=null;document.querySelector('#play').textContent='自動再生';render(...['left','right','head'].map(id=>Number(document.querySelector('#'+id).value)));};
 const play=document.querySelector('#play');play.disabled=false;
 play.onclick=()=>{if(timer){clearInterval(timer);timer=null;play.textContent='自動再生';return;}let i=0;play.textContent='停止';const sequence=[[1,1,0],[.5,.5,0],[0,0,0],[.5,.5,0],[1,1,0],[1,1,-1],[1,1,0],[1,1,1],[1,1,0]];timer=setInterval(()=>render(...sequence[i++%sequence.length]),250);};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(timer);timer=null;play.textContent='自動再生';}});
 status.textContent='Inox2D固定版を読込済み。値0と透明度の機能差は検証報告を参照してください。';
} catch(error){window.modelError=String(error);status.textContent='読込失敗: '+error;}

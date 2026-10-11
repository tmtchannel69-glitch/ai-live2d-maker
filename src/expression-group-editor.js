import {activateTouchButtons} from './touch-controls.js';
import {EXPRESSION_ROLES} from './expression-assets.js';
import {GROUP_LABELS,emptyGroups,defaultGroupTransform,validateGroups,suggestedAssignments,groupMatrix,parentMatrix,transformPoint,inversePoint,groupBounds,groupMembers} from './expression-groups.js';

export function createExpressionGroupEditor({getState,isLocked,onApply}) {
  const dialog=document.createElement('dialog');dialog.id='group-dialog';dialog.className='touch-editor-dialog';dialog.setAttribute('aria-labelledby','group-title');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="group-title">素材をまとめて動かす</h2><button id="group-close" class="secondary">閉じる</button></div>
  <p class="muted">顔全体を動かすと左右の目・口も動きます。確定まで下書きです。元の素材の配置は変えません。</p>
  <label>調整するグループ<select id="group-id"></select></label><p id="group-members" class="muted"></p><button id="group-suggest" class="secondary">役割に合わせてまとめる</button>
  <div class="touch-deform-toolbar"><label>指の操作<select id="group-mode"><option value="move">移動</option><option value="rotate">回転</option><option value="scale">大きさ</option><option value="pivot">中心点</option><option value="pan">拡大画面を移動</option></select></label><label>画面の拡大<select id="group-zoom"><option value="1">1倍</option><option value="2">2倍</option><option value="3">3倍</option><option value="4">4倍</option></select></label></div>
  <div id="group-viewport" class="touch-editor-viewport"><canvas id="group-canvas" aria-label="素材グループの移動・回転・大きさの編集"></canvas></div>
  <p class="muted">移動は枠内、回転・大きさは黄色の点、中心点は青い印を動かします。中心を変えると回転・大きさの見え方も変わります。</p>
  <div class="touch-deform-nudges"><button class="secondary" data-group-nudge="left">← 左</button><button class="secondary" data-group-nudge="up">↑ 上</button><button class="secondary" data-group-nudge="down">↓ 下</button><button class="secondary" data-group-nudge="right">→ 右</button></div>
  <div class="touch-deform-history"><button id="group-turn-left" class="secondary">左に1度</button><button id="group-turn-right" class="secondary">右に1度</button><button id="group-smaller" class="secondary">5%小さく</button><button id="group-larger" class="secondary">5%大きく</button></div>
  <details><summary>数値で微調整</summary><form id="group-form"><div id="group-fields" class="group-fields"></div><button class="secondary" id="group-number-apply">数値を下書きに反映</button></form></details>
  <button id="group-center" class="secondary">素材の中心に合わせる</button><button id="group-reset" class="secondary">このグループを元に戻す</button>
  <details id="group-membership"><summary>素材のまとめ方と表示範囲</summary><p class="muted">表示範囲を一緒に動かす場合だけチェックします。瞬きの形には追従しません。</p><div id="group-assignments"></div><button id="group-clear" class="secondary">まとめて動かす設定を解除</button></details>
  <p id="group-status" role="status" aria-live="polite"></p><div class="touch-deform-history"><button id="group-undo" class="secondary">取り消し</button><button id="group-redo" class="secondary">やり直し</button></div>
  <div class="touch-deform-actions"><button id="group-cancel" class="secondary">変更せず戻る</button><button id="group-confirm" class="primary">まとめ方を確定</button></div>`;
  const $=s=>dialog.querySelector(s);
  for(const [id,label] of Object.entries(GROUP_LABELS)){const o=document.createElement('option');o.value=id;o.textContent=label;$('#group-id').append(o);}
  const fields={dx:['横移動（元画像の%）',-100,100,100],dy:['縦移動（元画像の%）',-100,100,100],pivotX:['中心の横位置（元画像の%）',0,100,100],pivotY:['中心の縦位置（元画像の%）',0,100,100],angle:['角度（度）',-180,180,1],scale:['大きさ（%）',10,400,100]};
  for(const [id,[label,min,max]] of Object.entries(fields)) {const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');Object.assign(input,{id:`group-${id}`,type:'number',min:String(min),max:String(max),step:'any',required:true});l.append(input);$('#group-fields').append(l);}
  document.body.append(dialog);activateTouchButtons(dialog);
  const canvas=$('#group-canvas'),ctx=canvas.getContext('2d'),viewport=$('#group-viewport');
  let draft=null,assets=[],clips={},render=null,gesture=null,undo=[],redo=[],confirm=onApply,keyReference=null;
  const id=()=>$('#group-id').value,setting=()=>draft.transforms[id()]||defaultGroupTransform(),clone=()=>structuredClone(draft);
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function remember(before){if(JSON.stringify(before)===JSON.stringify(draft))return;undo.push(before);if(undo.length>30)undo.shift();redo=[];}
  function numericFields(){if(!draft)return;const s=setting();for(const [k,[,,,factor]] of Object.entries(fields))$(`#group-${k}`).value=Number((s[k]*factor).toFixed(6));}
  function rows(){
    $('#group-assignments').replaceChildren();
    for(const a of assets){
      const row=document.createElement('div');row.className='group-assignment';const label=document.createElement('label');label.textContent=EXPRESSION_ROLES.find(([role])=>role===a.role)[1];const select=document.createElement('select');select.dataset.groupRole=a.role;
      for(const [value,text] of [['','まとめて動かさない'],...Object.entries(GROUP_LABELS)]){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}select.value=draft.assignments[a.role]||'';label.append(select);
      const followLabel=document.createElement('label');followLabel.className='group-follow';const check=document.createElement('input');check.type='checkbox';check.dataset.groupFollow=a.role;check.checked=Boolean(draft.clipFollow[a.role]);check.disabled=!draft.assignments[a.role] || !clips[a.role];followLabel.append(check,document.createTextNode('表示範囲も一緒に動かす'));row.append(label,followLabel);$('#group-assignments').append(row);
      select.addEventListener('change',()=>{cancelGesture();const before=clone();if(select.value)draft.assignments[a.role]=select.value;else {delete draft.assignments[a.role];delete draft.clipFollow[a.role];}remember(before);rows();draw();controls();});
      check.addEventListener('change',()=>{cancelGesture();const before=clone();if(check.checked)draft.clipFollow[a.role]=true;else delete draft.clipFollow[a.role];remember(before);draw();controls();});
    }
  }
  function geometry(){
    const bounds=groupBounds(draft,id(),assets,canvas.width,canvas.height),m=groupMatrix(draft,id(),canvas.width,canvas.height),s=setting();
    return {bounds,pivot:transformPoint(m,[s.pivotX*canvas.width,s.pivotY*canvas.height]),handle:bounds?[bounds.right,bounds.bottom]:null};
  }
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);if(!draft || !render)return;render(ctx,draft);
    const {bounds,pivot,handle}=geometry(),unit=canvas.width/(canvas.getBoundingClientRect().width||canvas.width);
    ctx.save();ctx.strokeStyle='#7ef4ff';ctx.fillStyle='#7ef4ff';ctx.lineWidth=2*unit;
    if(bounds)ctx.strokeRect(bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);
    ctx.beginPath();ctx.arc(...pivot,8*unit,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(pivot[0]-12*unit,pivot[1]);ctx.lineTo(pivot[0]+12*unit,pivot[1]);ctx.moveTo(pivot[0],pivot[1]-12*unit);ctx.lineTo(pivot[0],pivot[1]+12*unit);ctx.stroke();
    if(handle){ctx.fillStyle='#ffdb70';ctx.beginPath();ctx.arc(...handle,9*unit,0,Math.PI*2);ctx.fill();}ctx.restore();
  }
  function controls(){
    if(!draft)return;const members=groupMembers(draft,id(),assets),s=setting();$('#group-members').textContent=`${id()==='face'?'親なし。子の目・口も対象。':'親：顔全体。'} ${members.length}素材。${keyReference?'この位置だけを編集します。所属は通常のグループ画面で変更できます。':members.length?'所属の確認・変更は下の「素材のまとめ方と表示範囲」へ。':'役割に合わせてまとめてください。'}`;
    $('#group-status').textContent=`下書き：横 ${(s.dx*100).toFixed(2)}% ／ 縦 ${(s.dy*100).toFixed(2)}% ／ 角度 ${s.angle.toFixed(2)}度 ／ 大きさ ${(s.scale*100).toFixed(2)}%。`;
    $('#group-undo').disabled=!undo.length || Boolean(gesture);$('#group-redo').disabled=!redo.length || Boolean(gesture);$('#group-center').disabled=!members.length;
  }
  function refresh(withRows=false){numericFields();if(withRows)rows();draw();controls();}
  function change(fn){cancelGesture();if(!draft || isLocked())return;const before=clone();fn();remember(before);refresh();}
  function cancelGesture(){if(!gesture)return;const g=gesture;gesture=null;draft=g.before;if(canvas.hasPointerCapture(g.pointer))canvas.releasePointerCapture(g.pointer);refresh();}
  function close(){cancelGesture();if(dialog.open)dialog.close();draft=null;assets=[];clips={};render=null;confirm=onApply;keyReference=null;undo=[];redo=[];$('#group-assignments').replaceChildren();ctx.clearRect(0,0,canvas.width,canvas.height);}
  function position(e){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];}
  canvas.addEventListener('pointerdown',e=>{
    if(gesture){cancelGesture();return;}if(!draft || isLocked() || !e.isPrimary || e.button!==0)return;
    const mode=$('#group-mode').value,pos=position(e),g=geometry(),padding=24*canvas.width/canvas.getBoundingClientRect().width;
    if(mode==='move' && (!g.bounds || pos[0]<g.bounds.left-padding || pos[0]>g.bounds.right+padding || pos[1]<g.bounds.top-padding || pos[1]>g.bounds.bottom+padding))return;
    if(['rotate','scale'].includes(mode) && (!g.handle || Math.hypot(pos[0]-g.handle[0],pos[1]-g.handle[1])>padding || Math.hypot(pos[0]-g.pivot[0],pos[1]-g.pivot[1])<1))return;
    if(mode==='pivot' && Math.hypot(pos[0]-g.pivot[0],pos[1]-g.pivot[1])>padding)return;
    gesture={pointer:e.pointerId,mode,start:pos,before:clone(),s:{...setting()},geometry:g,parent:parentMatrix(draft,id(),canvas.width,canvas.height),client:[e.clientX,e.clientY],scroll:[viewport.scrollLeft,viewport.scrollTop]};canvas.setPointerCapture(e.pointerId);controls();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!gesture || gesture.pointer!==e.pointerId)return;const g=gesture;
    if(g.mode==='pan'){viewport.scrollLeft=g.scroll[0]+g.client[0]-e.clientX;viewport.scrollTop=g.scroll[1]+g.client[1]-e.clientY;return;}
    const pos=position(e),s={...g.s},delta=inversePoint(g.parent,[pos[0]-g.start[0],pos[1]-g.start[1]],true);
    if(g.mode==='move'){s.dx=clamp(g.s.dx+delta[0]/canvas.width,-1,1);s.dy=clamp(g.s.dy+delta[1]/canvas.height,-1,1);}
    if(g.mode==='pivot') {const p=inversePoint(g.parent,pos);s.pivotX=clamp(p[0]/canvas.width-g.s.dx,0,1);s.pivotY=clamp(p[1]/canvas.height-g.s.dy,0,1);}
    if(g.mode==='rotate'){const p=g.geometry.pivot,from=Math.atan2(g.start[1]-p[1],g.start[0]-p[0]),to=Math.atan2(pos[1]-p[1],pos[0]-p[0]),angle=Math.atan2(Math.sin(to-from),Math.cos(to-from))*180/Math.PI;s.angle=clamp(g.s.angle+angle,-180,180);}
    if(g.mode==='scale'){const p=g.geometry.pivot;s.scale=clamp(g.s.scale*Math.hypot(pos[0]-p[0],pos[1]-p[1])/Math.hypot(g.start[0]-p[0],g.start[1]-p[1]),.1,4);}
    draft.transforms[id()]=s;refresh();
  });
  canvas.addEventListener('pointerup',e=>{if(!gesture || gesture.pointer!==e.pointerId)return;const g=gesture;gesture=null;canvas.releasePointerCapture(e.pointerId);if(g.mode!=='pan')remember(g.before);controls();});
  canvas.addEventListener('pointercancel',cancelGesture);canvas.addEventListener('lostpointercapture',cancelGesture);
  for(const selector of ['#group-id','#group-mode'])$(selector).addEventListener('change',()=>{cancelGesture();refresh();});
  $('#group-zoom').addEventListener('change',()=>{cancelGesture();canvas.style.width=`${Number($('#group-zoom').value)*100}%`;draw();});
  for(const b of dialog.querySelectorAll('[data-group-nudge]'))b.addEventListener('click',()=>change(()=>{const s={...setting()},direction=b.dataset.groupNudge,step=['left','up'].includes(direction)?-.005:.005,delta=inversePoint(parentMatrix(draft,id(),canvas.width,canvas.height),['left','right'].includes(direction)?[step*canvas.width,0]:[0,step*canvas.height],true);s.dx=clamp(s.dx+delta[0]/canvas.width,-1,1);s.dy=clamp(s.dy+delta[1]/canvas.height,-1,1);draft.transforms[id()]=s;}));
  for(const [button,k,amount] of [['turn-left','angle',-1],['turn-right','angle',1],['smaller','scale',.95],['larger','scale',1.05]])$(`#group-${button}`).addEventListener('click',()=>change(()=>{const s={...setting()};s[k]=k==='angle'?clamp(s[k]+amount,-180,180):clamp(s[k]*amount,.1,4);draft.transforms[id()]=s;}));
  $('#group-center').addEventListener('click',()=>change(()=>{const members=groupMembers(draft,id(),assets);if(!members.length)return;const left=Math.min(...members.map(a=>a.placement.x)),right=Math.max(...members.map(a=>a.placement.x+a.placement.width)),top=Math.min(...members.map(a=>a.placement.y)),bottom=Math.max(...members.map(a=>a.placement.y+a.placement.height));draft.transforms[id()]={...setting(),pivotX:clamp((left+right)/2,0,1),pivotY:clamp((top+bottom)/2,0,1)};}));
  $('#group-reset').addEventListener('click',()=>change(()=>{if(keyReference)draft.transforms[id()]={...keyReference};else delete draft.transforms[id()];}));
  $('#group-suggest').addEventListener('click',()=>{change(()=>{draft.assignments=suggestedAssignments(assets);});if(draft)rows();});
  $('#group-clear').addEventListener('click',()=>{change(()=>{draft=emptyGroups();});if(draft)rows();});
  function applyNumbers(){if(!draft || isLocked() || !$('#group-form').reportValidity())return false;const s=Object.fromEntries(Object.entries(fields).map(([k,[,,,factor]])=>[k,Number($(`#group-${k}`).value)/factor]));try{validateGroups({...draft,transforms:{...draft.transforms,[id()]:s}},assets,clips);change(()=>{draft.transforms[id()]=s;});return true;}catch(e){$('#group-status').textContent=e.message;return false;}}
  $('#group-form').addEventListener('submit',e=>{e.preventDefault();applyNumbers();});
  $('#group-undo').addEventListener('click',()=>{cancelGesture();if(!undo.length)return;redo.push(clone());draft=undo.pop();refresh(true);});
  $('#group-redo').addEventListener('click',()=>{cancelGesture();if(!redo.length)return;undo.push(clone());draft=redo.pop();refresh(true);});
  for(const k of ['close','cancel'])$(`#group-${k}`).addEventListener('click',close);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('#group-confirm').addEventListener('click',()=>{cancelGesture();if(!draft || isLocked()){close();return;}try{const next=validateGroups(draft,assets,clips);if(confirm(next))close();}catch(e){$('#group-status').textContent=e.message;}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});window.addEventListener('resize',()=>{cancelGesture();if(dialog.open)draw();});
  return {close,open({width,height,renderPreview,editGroup,initialGroups,onConfirm,keyLabel}){close();const state=getState();draft=structuredClone(initialGroups||state.groups);confirm=onConfirm||onApply;keyReference=editGroup?{...(state.groups.transforms[editGroup]||defaultGroupTransform())}:null;assets=[...state.assets];clips=state.clips;render=renderPreview;canvas.width=width;canvas.height=height;canvas.style.width='100%';$('#group-id').value=editGroup||'face';$('#group-id').disabled=Boolean(editGroup);$('#group-suggest').hidden=Boolean(editGroup);$('#group-membership').hidden=Boolean(editGroup);$('#group-title').textContent=editGroup?`${GROUP_LABELS[editGroup]}：${keyLabel}の動き`:'素材をまとめて動かす';$('#group-confirm').textContent=editGroup?'この位置の動きを確定':'まとめ方を確定';$('#group-mode').value='move';$('#group-zoom').value='1';dialog.showModal();viewport.scrollLeft=0;viewport.scrollTop=0;refresh(true);}};
}

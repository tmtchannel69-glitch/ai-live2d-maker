// Keep taps reliable after a captured canvas drag, without double activation.
export function activateTouchButtons(root) {
  for(const button of root.querySelectorAll('button')) {
    let contact=null,suppressClick=false;
    button.addEventListener('pointerdown',event=>{suppressClick=false;if(event.pointerType==='touch' && event.isPrimary && !button.disabled)contact={id:event.pointerId,x:event.clientX,y:event.clientY};});
    button.addEventListener('pointermove',event=>{if(contact && Math.hypot(event.clientX-contact.x,event.clientY-contact.y)>8)contact=null;});
    button.addEventListener('pointercancel',()=>{contact=null;});
    button.addEventListener('pointerup',event=>{if(!contact || contact.id!==event.pointerId)return;contact=null;if(button.disabled)return;button.click();suppressClick=true;});
    button.addEventListener('touchend',event=>{if(suppressClick)event.preventDefault();},{passive:false});
    button.addEventListener('click',event=>{if(suppressClick && event.isTrusted && event.detail>0){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},true);
  }
}

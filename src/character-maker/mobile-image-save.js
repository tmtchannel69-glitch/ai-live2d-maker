// Call directly from a tap, with an already prepared local Blob. Preparing an
// archive before navigator.share would lose Safari's user activation.
export async function shareOrSaveImage(blob,name,save){
  const file=new File([blob],name,{type:blob.type||'image/png'});
  let supported=false;
  try{supported=typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]});}catch{/* direct download remains available */}
  if(supported){
    try{await navigator.share({files:[file],title:'AI Live2D Maker 確認画像'});return 'shared';}
    catch(error){if(error.name==='AbortError')return 'cancelled';throw error;}
  }
  save(blob,name);return 'downloaded';
}

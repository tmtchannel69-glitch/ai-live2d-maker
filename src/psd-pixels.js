import {decode,convertIndexedToRgb,hasPngSignature} from 'fast-png';
function fail(message){throw new Error(message);}
export function pixels(bytes,width,height) {
  if(!hasPngSignature(bytes) || bytes.length<33)fail('パーツのPNGが正しくありません。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(16)!==width || view.getUint32(20)!==height)fail('AIパーツは元画像と同じサイズにしてください。');
  const png=decode(bytes,{checkCrc:true});
  if(png.depth!==8 && !png.palette)fail('PSD試作は8ビットのPNGに対応しています。素材ZIPをご利用ください。');
  if(png.iccEmbeddedProfile)fail('色プロファイル付きPNGのPSD化は試作対象外です。画像編集ソフトでsRGBに変換してください。');
  const data=png.palette?convertIndexedToRgb(png):png.data,channels=png.palette?png.palette[0].length:png.channels;
  const rgba=new Uint8ClampedArray(width*height*4);
  for(let i=0,j=0;i<width*height;i++,j+=channels) {
    const k=i*4,grey=channels<=2;
    rgba[k]=data[j];rgba[k+1]=grey?data[j]:data[j+1];rgba[k+2]=grey?data[j]:data[j+2];
    rgba[k+3]=channels===2?data[j+1]:channels===4?data[j+3]:255;
    if(!png.palette && png.transparency?.length && (grey?data[j]===png.transparency[0]:data[j]===png.transparency[0] && data[j+1]===png.transparency[1] && data[j+2]===png.transparency[2]))rgba[k+3]=0;
  }
  return rgba;
}
export function over(target,source) {
  for(let i=0;i<source.length;i+=4) {
    const a=source[i+3];if(!a)continue;
    if(a===255){target[i]=source[i];target[i+1]=source[i+1];target[i+2]=source[i+2];target[i+3]=255;continue;}
    const sa=a/255,da=target[i+3]/255,oa=sa+da*(1-sa);
    for(let c=0;c<3;c++)target[i+c]=Math.round((source[i+c]*sa+target[i+c]*da*(1-sa))/oa);
    target[i+3]=Math.round(oa*255);
  }
}

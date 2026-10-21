import {createServer} from 'node:http';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildModel} from './run.mjs';
const MAX=100*1024*1024;
const local=value=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
export function createModelBuildServer({binary=process.env.PSD2LIVE_BIN,validator=JSON.parse(process.env.PSD2LIVE_VALIDATOR_JSON||'[]')}={}){
  let busy=false;
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(req.headers.origin && !local(req.headers.origin)){json(403,{error:'ローカル開発画面から操作してください。'});return;}
    let available=false;try{if(binary && process.platform==='linux'){await access(binary,constants.X_OK);available=true;}}catch{}
    if(req.url==='/api/model-build/status' && req.method==='GET'){json(200,{configured:available,busy,experimental:true,officialCoreTested:false,vtubeStudioTested:false});return;}
    if(req.url!=='/api/model-build' || req.method!=='POST'){json(404,{error:'対象の操作がありません。'});return;}
    if(!available){json(503,{error:'モデル生成ツールが未設定です。開発用の起動手順を確認してください。'});req.resume();return;}
    if(busy){json(409,{error:'別のモデルを生成中です。'});req.resume();return;}
    if(req.headers['content-type']!=='application/zip'){json(415,{error:'制作引き継ぎZIPが必要です。'});req.resume();return;}
    if(Number(req.headers['content-length'])>MAX){json(413,{error:'入力は100 MiB以下にしてください。'});req.resume();return;}
    busy=true;const control=new AbortController();res.on('close',()=>{if(!res.writableEnded)control.abort();});
    try{
      const chunks=[];let size=0;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{control.abort();reject(new Error('送信の制限時間を超えました。'));},30_000);
        const finish=fn=>arg=>{clearTimeout(timer);fn(arg);};
        req.on('data',b=>{size+=b.length;if(size>MAX){chunks.length=0;clearTimeout(timer);reject(new Error('入力は100 MiB以下にしてください。'));}else if(!control.signal.aborted)chunks.push(b);});
        req.on('end',finish(resolve));req.on('error',finish(reject));req.on('aborted',finish(()=>{control.abort();reject(new Error('送信が中止されました。'));}));
      });
      const result=await buildModel(new Uint8Array(Buffer.concat(chunks)),{binary,validator,signal:control.signal});
      if(control.signal.aborted)return;
      res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="ai-live2d-experimental-model.zip"','X-AI-Live2D-Overlap-Candidates':String(result.report.preparation.sourceOverlapCandidates.length),'X-AI-Live2D-Unconfirmed-Motions':String(result.report.motionCoverage.filter(m=>['no_sampled_change','missing_recommended_id'].includes(m.status)).length),'X-AI-Live2D-Mouth-Overlap':result.report.mouthVisibility.status==='open_layer_visible_at_minimum'?'1':'0'});res.end(result.zip);
    }catch(e){if(!res.destroyed && !res.headersSent)json(422,{error:e.message||'モデル生成に失敗しました。'});}
    finally{busy=false;}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const server=createModelBuildServer();server.listen(8001,'127.0.0.1',()=>console.log('Model build trial listening on 127.0.0.1:8001. No official Core or VTube Studio validation is implied.'));}

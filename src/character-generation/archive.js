import {zip,strToU8} from 'fflate';
import {validateCharacterManifest,createRigMetadata,createInochiIntermediate} from '../../shared/generated-character.js';
import {createInochiGeometry} from '../../shared/generated-character.js';
import {validateDesignedCharacter,createDesignedRigMetadata} from '../../shared/designed-character.js';

export async function createCharacterArchive(character){
  const designed=character.manifest?.version===2,m=designed?await validateDesignedCharacter(character.manifest):validateCharacterManifest(character.manifest);
  if(!(character.assets instanceof Map)||character.assets.size!==m.parts.length||m.parts.some(p=>!(character.assets.get(p.role) instanceof Blob))||!(character.preview instanceof Blob))throw new Error('保存するパーツと完成画像が不足しています。');
  const files={};let total=0;
  const put=(name,bytes)=>{total+=bytes.length;if(total>16*1024*1024)throw new Error('保存サイズが上限を超えています。');files[name]=[bytes,{mtime:new Date('2000-01-01T00:00:00Z')}];};
  const json=(name,value)=>put(name,strToU8(JSON.stringify(value,null,2)+'\n'));
  for(const p of m.parts)put(p.file,new Uint8Array(await character.assets.get(p.role).arrayBuffer()));
  put('preview.png',new Uint8Array(await character.preview.arrayBuffer()));
  json('character_manifest.json',m);json('rig_metadata.json',designed?createDesignedRigMetadata(m):createRigMetadata(m));json('inochi_intermediate.json',designed?createInochiGeometry(m):createInochiIntermediate(m));json('generation_recipe.json',m.generator.recipe);
  if(designed){json('character_design.json',character.design);json('design_blueprint.json',character.blueprint);json('ai_generation_request.json',character.aiRequest);json('design_quality.json',character.quality);}
  if(character.native){
    if(character.native.report?.profile!==(designed?'designed-character-rig-v1':'generated-maid-rig-v1')||!(character.native.inp instanceof Uint8Array)||!(character.native.inx instanceof Uint8Array))throw new Error('Inochi2Dの出力が不完全です。');
    put('character.inp',character.native.inp);put('character.inx',character.native.inx);
    json('inochi_model.json',character.native.model);json('inochi_rig.json',character.native.rig);json('inochi_report.json',character.native.report);
  }
  put('README.txt',strToU8(`AI Live2D Maker: パーツから生成したキャラクター\n\n生成方式: ${m.generator.id==='dummy'?'配置確認用の図形':'端末内のテンプレート描画'}。AI自由生成ではありません。\nparts/ の33PNGは完成画像を切り分けず、独立して描いています。左右は本人基準（l＝画面右）。\n座標は768×1024キャンバスの左上基準ピクセル。order昇順で配置。anchorも同じ座標系です。\n虹彩/反射はclip_toの白目alphaで合成時にクリップ。口内PNGは通常顔では非表示です。\npreview.pngは背景設定を含み、パーツPNGは常に透過です。\nrig_metadata.json/inochi_intermediate.jsonは元の静止素材の配置と接続候補です。\n${character.native?'character.inp/character.inxにInochi2D用の動作を追加しました。実モデルのmesh/キーはinochi_rig.jsonとinochi_model.jsonです。INOCHI2D.txtも確認してください。':'このZIPに動作設定や実INP/INXは含みません。'}\nCubism/VTube Studio対応モデルではありません。\n\n再生成: 同じコード版のキャラ生成モードで色/背景/方式を選び直すか、\n開発サーバー起動後、node scripts/character-generation/export.mjs --recipe generation_recipe.json --output NEW_PRIVATE_DIRECTORY\n画像の描画結果はブラウザの実装により多少異なる場合があります。\n\nこのZIPは従来の「作業ファイルを開く」とは別形式です。生成画像をGitHubへアップロードしないでください。\n`));
  if(character.native)put('INOCHI2D.txt',strToU8('Inochi2D legacy INP/INX — SDK/Creator 0.8.6用\n\ncharacter.inpとcharacter.inxは同じruntimeコンテナです。生成したINXにはCreator専用の編集情報を含めず、公式Creatorで再保存できます。\nEyeOpenL/R: 本人左右、0で閉眼、1で開眼。MouthOpen: 0で通常口、1で開口。\nHeadX/HeadYは小さな平面移動、HeadTiltはZ回転です。胴体と襟は固定、首だけ連続変形します。\n元の33PNG/character_manifest.json/preview.pngは静止素材として維持しています。rig_metadata.json/inochi_intermediate.jsonも元の静止仕様です。\n実モデルのキーとmeshはinochi_rig.json、実ノードはinochi_model.json、制限はinochi_report.jsonに記録しています。\nモデルは背景透過です。単色背景の完成PNGとは同じ背景上で比較してください。\nこの実行のファイル生成と公式での実動作/保存、自然な見た目の合格は別判定です。髪物理/AI自由生成/Cubism/VTube Studio互換は含みません。\n'));
  return new Promise((resolve,reject)=>zip(files,{level:0},(error,data)=>error?reject(error):resolve(new Blob([data],{type:'application/zip'}))));
}

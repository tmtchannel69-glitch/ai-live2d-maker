import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';
import {buildGeneratedInochi} from '../shared/generated-character-inochi.js';
import {readCharacterContainer} from '../scripts/inochi2d/character-model.mjs';

test.use({hasTouch:true,isMobile:true});
async function download(page,id){
  const pending=page.waitForEvent('download');await page.locator('#'+id).click();const d=await pending,b=[];
  for await(const p of await d.createReadStream())b.push(p);return {name:d.suggestedFilename(),bytes:Buffer.concat(b)};
}
const json=(files,name)=>JSON.parse(strFromU8(files[name]));

test('one click creates actual INP/INX from 33 PNGs without an upload, with matching browser and Node output',async({page})=>{
  await page.goto('/');let apis=0;await page.route('**/api/**',r=>{apis++;return r.abort();});await page.locator('#mode-generate').click();
  await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('INP/INX');await expect(page.locator('#cg-model-output')).toBeVisible();
  const archive=unzipSync((await download(page,'cg-download-zip')).bytes),manifest=json(archive,'character_manifest.json');
  const inp=await download(page,'cg-download-inp'),inx=await download(page,'cg-download-inx');
  expect(inp.name).toBe('character.inp');expect(inx.name).toBe('character.inx');expect(inp.bytes).toEqual(Buffer.from(archive['character.inp']));expect(inx.bytes).toEqual(inp.bytes);
  const parsed=readCharacterContainer(new Uint8Array(inp.bytes));expect(parsed.textures).toHaveLength(33);
  expect(parsed.model.param.map(p=>p.name)).toEqual(['EyeOpenL','EyeOpenR','MouthOpen','HeadX','HeadY','HeadTilt']);
  expect(json(archive,'inochi_report.json')).toMatchObject({file_generation_passed:true,official_creator_tested:false,appearance_quality_passed:false,ai_generated:false,cubism_compatible:false});
  expect(json(archive,'inochi_rig.json')).toMatchObject({rest_pose_only:false,runtime_verified:false});
  const rebuilt=await buildGeneratedInochi(manifest,new Map(manifest.parts.map(p=>[p.role,archive[p.file]])));
  expect(inp.bytes).toEqual(Buffer.from(rebuilt.inp));expect(apis).toBe(0);
});

test('cancel during native encoding discards only the new job and leaves static generation usable',async({page})=>{
  await page.goto('/');const observed=await page.evaluate(async()=>{
    const {generateRiggedCharacter}=await import('/src/character-generation/model-generator.js');
    const {generateCharacter}=await import('/src/character-generation/generator.js');
    const controller=new AbortController();let hit=false,error=null;
    try{await generateRiggedCharacter({}, {signal:controller.signal,onProgress:p=>{if(p.stage==='model'&&p.completed===36){hit=true;controller.abort();}}});}catch(e){error=e.name;}
    const still=await generateCharacter();return {hit,error,parts:still.assets.size,staticModel:still.native??null};
  });expect(observed).toEqual({hit:true,error:'AbortError',parts:33,staticModel:null});
});

test('UI cancellation at the modeling stage retains the previous downloadable model and supports retry',async({page})=>{
  await page.goto('/');await page.locator('#mode-generate').click();await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('INP/INX');
  const before=await download(page,'cg-download-inp');
  await page.evaluate(()=>{
    const status=document.querySelector('#cg-status');window.nativeCancelObserver=new MutationObserver(()=>{
      if(status.textContent.includes('Inochi2Dモデルを作成中')){window.nativeCancelObserver.disconnect();document.querySelector('#cg-cancel').click();}
    });window.nativeCancelObserver.observe(status,{childList:true,subtree:true});
  });
  await page.locator('#cg-eyes').selectOption('blue');await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('生成を中止');await expect(page.locator('#cg-status')).toContainText('保持');
  expect((await download(page,'cg-download-inp')).bytes).toEqual(before.bytes);
  await page.locator('#cg-generate').click();await expect(page.locator('#cg-status')).toContainText('INP/INX');expect((await download(page,'cg-download-inp')).bytes.equals(before.bytes)).toBe(false);
});

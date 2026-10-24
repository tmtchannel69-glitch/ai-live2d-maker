// Inspect private PNGs after a separately authorized future experiment. This
// tool cannot authenticate AI provenance or create the missing 28 layers.
import {parseArgs} from 'node:util';
import {lstat,readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {validatePilotPlan} from '../../server/ai-image-pilot/plan.mjs';
import {inspectPilotPart} from '../../server/ai-image-pilot/quality.mjs';
import {readJsonFile,newPrivateDirectory,writePrivate,json} from './private-io.mjs';

const {values}=parseArgs({options:{plan:{type:'string'},input:{type:'string'},output:{type:'string'}}});
if(!values.plan||!values.input||!values.output)throw new Error('Usage: check-parts.mjs --plan pilot_plan.json --input PRIVATE_RAW_PNG_DIRECTORY --output NEW_PRIVATE_DIRECTORY');
const plan=await validatePilotPlan(await readJsonFile(values.plan)),records=[];
// Check all inputs before writing anything; absent/invalid parts are failures.
for(const request of plan.requests.filter(r=>r.part)){
  const file=join(resolve(values.input),request.role+'.png'),stat=await lstat(file);
  if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('Use regular RGBA PNG files up to 8MiB.');
  records.push({role:request.role,...inspectPilotPart(request,new Uint8Array(await readFile(file)))});
}
const output=await newPrivateDirectory(values.output);await mkdir(join(output,'parts'),{mode:0o700});
for(const item of records)if(item.tile_png)await writePrivate(join(output,'parts',item.role+'.png'),item.tile_png);
const report={format:'ai-live2d-pilot-structure-review',version:1,plan_id:plan.plan_id,model:plan.model,
  parts:records.map(r=>r.report),all_structure_passed:records.every(r=>r.report.structure_passed),
  actual_ai_generation_confirmed:false,semantic_quality_passed:false,complete_33_part_batch:false,inochi_model_generated:false,official_creator_tested:false,
  notice:'Inspection only. Keep the raw responses and API provenance separately. No resizing, alpha repair or dummy fallback was performed.'};
await writePrivate(join(output,'quality_report.json'),json(report));console.log(JSON.stringify({output,...report}));
if(!report.all_structure_passed)process.exitCode=1;

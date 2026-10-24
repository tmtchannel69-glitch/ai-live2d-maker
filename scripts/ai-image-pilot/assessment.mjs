// Offline read-only assessment of private pilot evidence. No network or API key.
import {parseArgs} from 'node:util';
import {join} from 'node:path';
import {readJsonFile,newPrivateDirectory,writePrivate,json} from './private-io.mjs';
import {assessTwoCallPilot} from '../../server/ai-image-pilot/assessment.mjs';

const {values}=parseArgs({options:{plan:{type:'string'},structure:{type:'string'},visual:{type:'string'},billing:{type:'string'},output:{type:'string'}}});
if(!values.plan||!values.output)throw new Error('Usage: assessment.mjs --plan pilot_plan.json --output NEW_PRIVATE_DIR [--structure quality_report.json] [--visual reviewer.json] [--billing billing.json]');
const plan=await readJsonFile(values.plan),structureReport=values.structure?await readJsonFile(values.structure):null,
  visualReview=values.visual?await readJsonFile(values.visual,8192):null,billing=values.billing?await readJsonFile(values.billing,8192):null;
const assessment=assessTwoCallPilot({plan,structureReport,visualReview,billing});
const output=await newPrivateDirectory(values.output);
await writePrivate(join(output,'assessment.json'),json(assessment));
console.log(JSON.stringify({output,part_structure:assessment.part_structure,visual_review_passed:assessment.visual_review?.passed??null,
  spend_known:assessment.billing_transcription!==null,ready_for_general_publication:false,external_requests_sent:0}));

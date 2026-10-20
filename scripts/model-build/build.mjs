#!/usr/bin/env node
// Local-only trial. PSD2LIVE_BIN must be a trusted, separately built CLI.
import {readFile,writeFile} from 'node:fs/promises';
import {buildModel} from './run.mjs';
const [input,output]=process.argv.slice(2);
if(!input || !output){console.error('Usage: PSD2LIVE_BIN=/path/to/cli node scripts/model-build/build.mjs handoff.zip output.zip');process.exitCode=1;}
else try{const result=await buildModel(new Uint8Array(await readFile(input)),{binary:process.env.PSD2LIVE_BIN,validator:JSON.parse(process.env.PSD2LIVE_VALIDATOR_JSON||'[]')});await writeFile(output,result.zip,{flag:'wx'});console.log(JSON.stringify(result.report,null,2));}catch(e){console.error(e.message);process.exitCode=1;}

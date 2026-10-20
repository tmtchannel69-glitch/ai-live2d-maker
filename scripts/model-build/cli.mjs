#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
try{
  if(!process.env.PSD2LIVE_CLASSPATH_FILE)throw new Error('PSD2LIVE_CLASSPATH_FILE is required.');
  const cp=readFileSync(process.env.PSD2LIVE_CLASSPATH_FILE,'utf8').trim();if(!cp)throw new Error('Empty compiler classpath.');
  const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin','java'):'java';
  const result=spawnSync(java,['-Xmx2g','-Djava.awt.headless=true',`-Duser.home=${join(dirname(process.env.PSD2LIVE_CLASSPATH_FILE),'.psd2live-home')}`,'-cp',cp,'io.github.psd2live.MainKt',...process.argv.slice(2)],{stdio:'inherit'});
  if(result.error)throw result.error;process.exitCode=result.status??1;
}catch(e){console.error(e.message);process.exitCode=1;}

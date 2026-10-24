"""Optional Linux-only, official Creator 0.8.6 roundtrip of a private matrix.

Requires prepared Xvfb/configuration from INOCHI2D_CREATOR_CHECK.md. Uses the
existing GUI/value/save/texture/structure inspectors; no model edits/rigging.
Ordinary first-run/donation countdown is allowed to finish before Close.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/inochi2d'))
from creator_ui import CreatorUI

EXPECTED_BINARY='2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def trial(a):
    source=Path(a.input).resolve();output=Path(a.output).resolve();runtime=Path(a.runtime).resolve();binary=Path(a.creator).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private output directory outside Git.')
    if sha(binary)!=EXPECTED_BINARY:raise ValueError('Use the pinned unmodified official Linux Creator 0.8.6 binary.')
    running=subprocess.run(['pgrep','-f','^'+str(binary)+' '],capture_output=True,text=True)
    if running.returncode==0:raise ValueError('Close existing Creator processes first. This tool never takes over another session.')
    names=a.names.split(',')
    if not names or any(n not in ['soft','bob','cool'] for n in names) or len(set(names))!=len(names):raise ValueError('Select unique matrix names soft,bob,cool.')
    output.mkdir(mode=0o700);reports=[]
    env={**os.environ,'DISPLAY':a.display,'LIBGL_ALWAYS_SOFTWARE':'1','XDG_CONFIG_HOME':str(runtime/'config'),
         'XDG_CACHE_HOME':str(runtime/'cache'),'XDG_STATE_HOME':str(runtime/'state'),'XDG_RUNTIME_DIR':str(runtime/'runtime'),'MESA_SHADER_CACHE_DIR':str(runtime/'cache')}

    def command(script,parts,log):
        with log.open('w') as stream:subprocess.run([sys.executable,str(ROOT/script),*map(str,parts)],cwd=ROOT,check=True,stdout=stream,stderr=subprocess.STDOUT)
    def launch(working,log):
        stream=log.open('w');p=subprocess.Popen(['dbus-run-session','--',str(binary),str(working)],env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            time.sleep(12)
            if p.poll() is not None:raise ValueError('Official Creator exited; inspect its private log.')
            ui=CreatorUI(a.xdotool,a.display,working);shot=ui.snapshot()
            label=ui.text(shot,(611,551,676,583))
            if 'close' not in label.lower():shot.save(log.with_suffix('.png'));raise ValueError('Expected ordinary countdown/Close notice was not verified: '+label)
            ui.click(641,568,hold=.4);ui.pointer_away();time.sleep(.5)
            return p,stream
        except BaseException:
            if p.poll() is None:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=10)
            stream.close();raise
    def stop(p,stream):
        if p.poll() is None:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=10)
        stream.close()

    for name in names:
        folder=output/name;folder.mkdir(mode=0o700);original=source/name/'character.inp';working=folder/'creator-saved.inx'
        shutil.copyfile(source/name/'character.inx',working)
        base=['--input',source/name,'--model',working,'--xdotool',a.xdotool,'--display',a.display]
        p,stream=launch(working,folder/'creator-before.log')
        try:
            command('scripts/character-generation/verify-creator.py',[*base,'--output',folder/'before'],folder/'before.log')
            command('scripts/inochi2d/save-creator.py',['--working',working,'--generated',original,'--output',folder/'save.json','--xdotool',a.xdotool,'--display',a.display,'--input-delay-scale','2.5'],folder/'save.log')
            command('scripts/inochi2d/check-creator-save.py',['--generated',original,'--saved',working,'--output',folder/'textures.json'],folder/'textures.log')
            command('scripts/inochi2d/check-rig-retention.py',['--generated',original,'--saved',working,'--output',folder/'structure.json'],folder/'structure.log')
        finally:stop(p,stream)
        p,stream=launch(working,folder/'creator-after.log')
        try:command('scripts/character-generation/verify-creator.py',[*base,'--output',folder/'after','--compare',folder/'before'],folder/'after.log')
        finally:stop(p,stream)
        command('scripts/character-generation/analyze-creator.py',['--evidence',folder/'before','--output',folder/'independent-before.json'],folder/'independent-before.log')
        command('scripts/character-generation/analyze-creator.py',['--evidence',folder/'after','--output',folder/'independent-after.json'],folder/'independent-after.log')
        before=json.loads((folder/'before/report.json').read_text());after=json.loads((folder/'after/report.json').read_text())
        report={'name':name,'generated_sha256':sha(original),'saved_sha256':sha(working),'before_states':len(before['poses']),'fresh_reload_states':len(after['poses']),
                'max_reload_changed_pixels':max(p['saved_reload_viewport_changed_pixels'] for p in after['poses']),'official_creator_motion_save_reload_passed':True,'appearance_quality_passed':False,'ai_generated':False}
        reports.append(report);print(json.dumps(report),flush=True)
        (output/'official-summary.json').write_text(json.dumps({'binary_sha256':EXPECTED_BINARY,'variants':reports,'ai_generation_tested':False},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['input','output','creator','runtime','xdotool']:p.add_argument('--'+key,required=True)
    p.add_argument('--display',default=':94');p.add_argument('--names',default='soft,bob,cool');trial(p.parse_args())

"""Capture the initial fitted view of a pinned official Creator model.
Requires the existing private 1280x960 setup. No rig edits or source painting.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/inochi2d'))
from creator_ui import CreatorUI
PIN='2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def capture(a):
    model=Path(a.model).resolve();binary=Path(a.creator).resolve();runtime=Path(a.runtime).resolve();out=Path(a.output).resolve()
    if out.is_relative_to(ROOT) or out.exists():raise ValueError('Use a new private directory outside Git.')
    if sha(binary)!=PIN:raise ValueError('Use the pinned unmodified official 0.8.6 binary.')
    if subprocess.run(['pgrep','-f','^'+str(binary)+' '],capture_output=True).returncode==0:raise ValueError('Another Creator is running; not taking it over.')
    before=sha(model);out.mkdir(mode=0o700)
    env={**os.environ,'DISPLAY':a.display,'LIBGL_ALWAYS_SOFTWARE':'1','XDG_CONFIG_HOME':str(runtime/'config'),'XDG_CACHE_HOME':str(runtime/'cache'),'XDG_STATE_HOME':str(runtime/'state'),'XDG_RUNTIME_DIR':str(runtime/'runtime'),'MESA_SHADER_CACHE_DIR':str(runtime/'cache')}
    with (out/'creator.log').open('w') as log:
        process=subprocess.Popen(['dbus-run-session','--',str(binary),str(model)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            time.sleep(12)
            if process.poll() is not None:raise ValueError('Creator exited; inspect its private log.')
            ui=CreatorUI(a.xdotool,a.display,model);shot=ui.snapshot();label=ui.text(shot,(611,551,676,583))
            if 'close' not in label.lower():shot.save(out/'unexpected-notice.png');raise ValueError('Expected normal Close notice not verified.')
            ui.click(641,568,hold=.4);ui.pointer_away();time.sleep(.8)
            ui.snapshot().save(out/'official-initial-fit.png')
        finally:
            if process.poll() is None:os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=10)
    if sha(model)!=before:raise ValueError('Input model unexpectedly changed.')
    (out/'capture.json').write_text(json.dumps({'official_creator_version':'0.8.6','binary_sha256':PIN,'opened_model_sha256':before,'source_model_unchanged':True,'initial_view_only':True,'appearance_quality_passed':False},indent=2)+'\n')
    print(json.dumps({'output':str(out),'opened_model_sha256':before,'source_model_unchanged':True}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for k in ['model','creator','runtime','output','xdotool']:p.add_argument('--'+k,required=True)
    p.add_argument('--display',default=':96');capture(p.parse_args())

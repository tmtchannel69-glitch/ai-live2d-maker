"""Confirm a real official GUI save of a private INX working copy.

The ordinary first-run notice must already be closed. Holds keyboard edges
across SDL frames and observes the resulting file; a keypress alone is never
reported as a successful save. Does not alter generated model files.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]


def digest(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def save(args):
    working=Path(args.working).resolve();generated=Path(args.generated).resolve();out=Path(args.output).resolve()
    if working==generated or working.is_relative_to(ROOT) or out.is_relative_to(ROOT) or out.exists():
        raise ValueError('Use a separate existing private INX working copy and new private report.')
    if working.suffix!='.inx' or not working.is_file():raise ValueError('Existing INX working copy required.')
    if working.samefile(generated):raise ValueError('Working copy must not be a link to the generated input.')
    original=digest(generated);before=digest(working);mtime=working.stat().st_mtime_ns
    env=os.environ.copy();env['DISPLAY']=args.display
    env['LD_LIBRARY_PATH']=str(Path(args.xdotool).resolve().parents[1]/'lib/x86_64-linux-gnu')+':'+env.get('LD_LIBRARY_PATH','')
    def xdo(*parts):return subprocess.check_output([args.xdotool,*parts],env=env).decode().strip()
    windows=xdo('search','--onlyvisible','--name','^Inochi Creator').splitlines()
    if len(windows)!=1:raise ValueError('Exactly one official Creator window is required.')
    if working.name not in xdo('getwindowname',windows[0]):raise ValueError('Working filename is not in Creator title.')
    xdo('windowfocus','--sync',windows[0]);time.sleep(.2)
    try:
        xdo('keydown','Control_L');time.sleep(.15);xdo('keydown','s');time.sleep(.25)
    finally:
        xdo('keyup','s');time.sleep(.15);xdo('keyup','Control_L')
    started=time.monotonic()
    while time.monotonic()-started<15:
        time.sleep(.25)
        if working.stat().st_mtime_ns!=mtime:
            # A stable size/hash over another two frames avoids accepting the
            # initial truncate/write as a completed serializer operation.
            first=digest(working);time.sleep(.3)
            if working.stat().st_size>0 and digest(working)==first:break
    else:raise ValueError('No completed Creator save observed; check the notice/focus and do not claim a roundtrip.')
    if digest(generated)!=original:raise ValueError('Generated input changed during save audit.')
    report={'official_gui_save_observed':True,'generated_sha256_unchanged':original,
        'working_sha256_before':before,'creator_saved_sha256':digest(working),
        'saved_bytes':working.stat().st_size,'save_wait_seconds':round(time.monotonic()-started,3),
        'runtime_reload_verified':False,'appearance_quality_passed':False}
    out.write_text(json.dumps(report,indent=2));print(json.dumps(report))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['working','generated','output','xdotool']:p.add_argument('--'+key,required=True)
    p.add_argument('--display',default=':94');save(p.parse_args())

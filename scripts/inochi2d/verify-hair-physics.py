"""Record native 0.8.6 pendulum motion in the official Creator GUI.

Starts from an ordinary reset at HeadX=+1. Filtering HairSway exposes all nine
numeric outputs while the toolbar's Reset Parameters moves HeadX back to zero.
Snapshots are timestamped before offline OCR, so OCR cannot set the sampling
rate. No Python physics replacement or assumed fixed frame rate is used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

import numpy as np
from PIL import Image,ImageDraw

from creator_ui import CreatorUI

ROOT=Path(__file__).resolve().parents[2]


def digest(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def run(args):
    output=Path(args.output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private physics-audit directory.')
    output.mkdir(parents=True)
    layout=json.loads(Path(args.manifest).read_text());reference=json.loads(Path(args.reference).read_text())
    strands=layout['hair_rig']['strands']
    if not layout['hair_rig']['physics_configured'] or not 1<=len(strands)<=9:
        raise ValueError('This fixed-layout audit supports one to nine configured native drivers.')
    ui=CreatorUI(args.xdotool,args.display,args.model);viewport=tuple(reference['viewport_roi']);torso=tuple(reference['fixed_torso_roi'])
    ui.click(457,923);ui.pointer_away();time.sleep(.4)  # documented native zoom button
    ui.filter('HeadX');ui.click(289,173,shift=True);ui.pointer_away();time.sleep(.3)
    if abs(ui.value(ui.snapshot(),138)-1)>.005:raise ValueError('Could not establish HeadX=+1.')
    ui.click(118,36);ui.pointer_away();time.sleep(.4)  # ordinary Reset Physics
    ui.filter('HairSway');ui.pointer_away();time.sleep(.3)
    title_image=ui.snapshot();title_image.save(output/'native-driver-controls.png')
    positions=[];titles={}
    for i,p in enumerate(strands):
        dy=round(i*91.4);text=ui.text(title_image,(126,112+dy,320,140+dy));titles[p['parameter']]=text
        found=re.search(r'hairsway([0-9o]{2})',re.sub(r'\s','',text).lower())
        if not found or int(found[1].replace('o','0'))!=int(p['parameter'][-2:]):
            raise ValueError('Native driver output heading could not be verified: '+repr(text))
        positions.append(138+dy)
    rest=[]
    for i in range(5):
        im=ui.snapshot();im.save(output/f'rest-{i:02d}.png');rest.append(im);time.sleep(.12)
    # ImGui's ordinary Reset Parameters button activates on release. Drivers
    # stay enabled; their internal velocities are deliberately not reset here.
    ui.xdo('mousemove',192,36);time.sleep(.3*ui.scale)
    ui.xdo('mousedown',1);time.sleep(1*ui.scale);ui.xdo('mouseup',1)
    # Leave the pointer over the button until SDL has sampled the release.
    # Moving away immediately cancels an ordinary ImGui button click; keeping
    # it here captures the first response without adding a settling delay.
    # Its tooltip is outside the measured model viewport and numeric fields.
    started=time.monotonic();samples=[]
    for i in range(72):
        im=ui.snapshot();t=time.monotonic()-started
        samples.append((t,im));time.sleep(.02)
    (output/'capture-times.json').write_text(json.dumps([{'frame':i,'time_seconds':t} for i,(t,_) in enumerate(samples)],indent=2))
    for i,(_,im) in enumerate(samples):im.save(output/f'motion-{i:03d}.png')
    ui.filter('HeadX');ui.pointer_away();time.sleep(.2)
    head_after=ui.value(ui.snapshot(),138)
    if abs(head_after)>.005:raise ValueError('Toolbar operation did not return HeadX to zero.')
    rest_values=[[ui.value(im,top) for top in positions] for im in rest]
    measured=[];rest_body=np.array(rest[-1].crop(torso))
    if np.max(np.std(rest_body,axis=(0,1)))<2:raise ValueError('Reference body region has insufficient visible detail.')
    for t,im in samples:
        values={p['parameter']:ui.value(im,top) for p,top in zip(strands,positions)}
        changed=int(np.any(np.array(im.crop(torso))!=rest_body,axis=2).sum())
        if changed:raise ValueError('Native hair simulation changed measured torso interior.')
        measured.append({'time_seconds':round(t,4),'outputs':values,'fixed_torso_changed_pixels':changed})
    verdicts=[]
    for i,p in enumerate(strands):
        name=p['parameter'];values=np.array([s['outputs'][name] for s in measured]);peak=float(np.max(np.abs(values)))
        rest_peak=max(abs(row[i]) for row in rest_values);tail=float(np.max(np.abs(values[-6:])))
        overshoot=bool(values.min()<-.01 and values.max()>.01)
        passed=rest_peak<=.02 and peak>=.03 and overshoot and tail<=max(.02,peak*.25)
        verdicts.append({'parameter':name,'initial_rest_max_abs':rest_peak,'minimum':float(values.min()),'maximum':float(values.max()),
            'peak_abs':peak,'last_six_samples_max_abs':tail,'signed_sway_back_observed':overshoot,'motion_decay_passed':passed})
    first=np.array(samples[0][1].crop(viewport));last=np.array(samples[-1][1].crop(viewport))
    changes=[int(np.any(np.array(im.crop(viewport))!=last,axis=2).sum()) for _,im in samples]
    report={'runtime':'official Inochi Creator 0.8.6','model_sha256':digest(args.model),
        'native_physics_driver_count':len(strands),'verified_output_titles':titles,
        'head_input':'ordinary HeadX +1 -> 0 via Reset Parameters; no rigging/key edits',
        'head_x_after':head_after,'sample_count':len(samples),'last_sample_seconds':measured[-1]['time_seconds'],
        'trigger_input_hold_seconds':ui.scale,
        'actual_timestamps_not_fixed_fps':True,'samples':measured,'outputs':verdicts,
        'viewport_changed_pixels_vs_settled':changes,'native_physics_runtime_passed':all(p['motion_decay_passed'] for p in verdicts) and max(changes)>0,
        'saved_model_requires_separate_fresh_process_check':True,'appearance_quality_passed':False,
        'notes':['Outputs were read from the official SDK-driven parameter values; Python did not simulate physics.',
                 'Timing follows real GUI deltaTime and OS scheduling; equal movie pixels across machines are not promised.',
                 'Small local-fragment bends do not certify scalp roots, depth, collisions or natural finished hair.']}
    (output/'physics-creator-report.json').write_text(json.dumps(report,indent=2))
    with (output/'native-physics-values.csv').open('w') as f:
        f.write('time_seconds,'+','.join(p['parameter'] for p in strands)+'\n')
        for s in measured:f.write(str(s['time_seconds'])+','+','.join(str(s['outputs'][p['parameter']]) for p in strands)+'\n')
    selected=[0,3,8,15,30,len(samples)-1];sheet=Image.new('RGB',(3*330,2*360),'#333333');draw=ImageDraw.Draw(sheet)
    for i,idx in enumerate(selected):
        im=samples[idx][1].crop(reference['face_roi']);im.thumbnail((320,305));x,y=i%3*330,i//3*360
        draw.text((x+5,y+5),f"t={measured[idx]['time_seconds']:.3f}s",fill='white');draw.text((x+5,y+20),str(list(measured[idx]['outputs'].values())),fill='white');sheet.paste(im,(x+5,y+45))
    sheet.save(output/'native-physics-contact.png');ui.filter('');ui.pointer_away()
    if not report['native_physics_runtime_passed']:raise ValueError('Native pendulum motion/overshoot/decay not verified for every output; inspect private report.')
    print(json.dumps({'native_physics_runtime_passed':True,'outputs':verdicts,'samples':len(samples)}))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['model','manifest','reference','output','xdotool']:p.add_argument('--'+key,required=True)
    p.add_argument('--display',default=':94');run(p.parse_args())

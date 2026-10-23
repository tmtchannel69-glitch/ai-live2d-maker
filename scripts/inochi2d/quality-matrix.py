"""Controlled robustness matrix from ONE private image, not a new-image corpus.

Levels are experimental definitions: head crop, original bust, quarter-sized
image. An occluded-eye negative control is also attempted. Every trial receives
only pixels; corpus derivation coordinates are never passed to the generator.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from server.inochi_worker import decode_image
from server.inochi_preparation import _detect_face, _eye_regions


def run(args):
    output=Path(args.output).resolve()
    if output.is_relative_to(ROOT) or output.exists():
        raise ValueError('Use a new private directory outside Git.')
    output.mkdir(parents=True, mode=0o700); inputs=output/'inputs'; inputs.mkdir()
    source=Path(args.source).resolve()
    with decode_image(source) as image:
        rgb=np.array(image.convert('RGB')); x,y,w,h=_detect_face(rgb)
        box=(max(0, round(x-.2*w)), max(0, round(y-.4*h)),
             min(image.width, round(x+1.2*w)), min(image.height, round(y+1.1*h)))
        image.crop(box).save(inputs/'level1.png')
        image.resize((max(64, image.width//4), max(64, image.height//4))).save(inputs/'level3.png')
        occluded=image.copy(); draw=ImageDraw.Draw(occluded)
        eye=_eye_regions(rgb, [x,y,w,h])['l']['box']
        draw.rectangle(tuple(eye), fill=(235,207,202,255))
        occluded.save(inputs/'occluded.png')
    cases=[('level1', 1, inputs/'level1.png', 'controlled-head-and-shoulder-crop'),
           ('level2', 2, source, 'original-bust'),
           ('level3', 3, inputs/'level3.png', 'controlled-quarter-size'),
           ('occluded', 3, inputs/'occluded.png', 'controlled-one-eye-occlusion-negative-control')]
    if args.reference:
        cases.append(('reference-small', 3, Path(args.reference).resolve(), 'independent-small-reference-unsupported-angle'))
    records=[]
    for name,level,path,kind in cases:
        started=time.monotonic()
        command=[sys.executable, str(ROOT/'scripts/inochi2d/quality-trial.py'), '--source', str(path), '--output', str(output/name)]
        try:
            process=subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=180)
            (output/(name+'.log')).write_text(process.stdout+process.stderr, encoding='utf-8')
            success=process.returncode==0
            report=json.loads((output/name/'trial-report.json').read_text()) if success else None
            error=None if success else process.stderr.strip().splitlines()[-1][:500]
        except subprocess.TimeoutExpired:
            success,report,error=False,None,'180-second evaluation timeout'
        record={'case':name, 'level':level, 'input_kind':kind, 'source_group':'reference' if name=='reference-small' else 'same-owner-image',
            'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'file_generation_passed':success,'generation_report':report,'failure':error,
            'elapsed_seconds':round(time.monotonic()-started,3),'official_creator_passed':None,'appearance_quality_passed':False}
        records.append(record)
        print(json.dumps({'case':name,'generation_passed':success,'seconds':record['elapsed_seconds'],'failure':error}, ensure_ascii=False),flush=True)
    summary={'schema':1,'generator_profile':'aperture-head-v1','cases':records,
        'controlled_source_images':1,'additional_independent_reference_images':bool(args.reference),
        'warning':'Controlled crops/resizes/occlusion of the same picture do not measure generalization to new characters.',
        'level_definitions':{'1':'Head-and-shoulder crop with large face','2':'Original bust with long hair and complex clothing','3':'Quarter-resolution small face; additional occlusion negative control'},
        'file_generation_successes':sum(r['file_generation_passed'] for r in records),'attempts':len(records),
        'creator_verdict':'pending separate official runtime evidence; never infer from file generation',
        'appearance_verdict':'not production approved'}
    (output/'matrix-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--reference',help='Optional independently licensed private reference; caller records provenance separately')
    run(parser.parse_args())

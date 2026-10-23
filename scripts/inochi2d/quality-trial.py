"""Private opt-in one-image quality trial, separate from the app's stable API.

Usage: .venv/bin/python scripts/inochi2d/quality-trial.py --source IMAGE --output
/tmp/NEW_DIRECTORY [--assess-separation]. No manual detections/rigging accepted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from types import SimpleNamespace

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from server.inochi_worker import decode_image, save_preparation
from server.inochi_quality import prepare_quality_image, extend_blink_parts, _canvas


def assess_separation(image, prepared, output):
    from server.engine import SamEngine
    x, y, fw, fh = prepared['diagnostics']['face_box_xywh']
    w, h = image.size
    def point(a, b, label=1):
        return SimpleNamespace(x=max(0, min(1, a/w)), y=max(0, min(1, b/h)), label=label)
    def prompt(name, box, points):
        return SimpleNamespace(id=name, box=[max(0, min(1, v)) for v in
            (box[0]/w, box[1]/h, box[2]/w, box[3]/h)], all_points=points)
    prompts = [
        prompt('face', (x, y, x+fw, y+fh), [point(x+.5*fw, y+.6*fh), point(x+.35*fw, y+.55*fh), point(x+.65*fw, y+.55*fh)]),
        prompt('hair', (x-.35*fw, y-.5*fh, x+1.35*fw, y+1.4*fh),
               [point(x+.48*fw, y-.05*fh), point(x+.07*fw, y+.5*fh), point(x+.93*fw, y+.5*fh),
                point(x+.5*fw, y+.7*fh, 0), point(x+.5*fw, y+1.4*fh, 0)]),
        prompt('body', (0, y+.8*fh, w, h),
               [point(x+.5*fw, y+1.4*fh), point(x-.1*fw, y+1.4*fh), point(x+1.1*fw, y+1.4*fh),
                point(x+.5*fw, y+.6*fh, 0), point(x+.07*fw, y+.5*fh, 0)]),
    ]
    started = time.monotonic()
    masks = SamEngine().segment(image, prompts)
    out = output/'separation-candidates'; out.mkdir()
    source = np.array(image)
    records = []
    for p, mask in zip(prompts, masks):
        rgba = source.copy(); rgba[~mask] = 0
        Image.fromarray(rgba).save(out/(p.id+'.png'))
        records.append({'role': p.id, 'pixels': int(mask.sum())})
    report = {'automatic_prompts': True, 'manual_points': False, 'elapsed_seconds': round(time.monotonic()-started, 3),
        'candidates': records, 'adopted_in_model': False, 'quality_passed': False,
        'overlap_pixels': {'face_hair': int((masks[0] & masks[1]).sum()),
                           'body_hair': int((masks[2] & masks[1]).sum())},
        'findings': ['Face/neck and long hair candidates are extractable, but semantic boundary quality requires review.',
            'One image does not resolve front/back hair or hidden neck/body artwork.',
            'The model instead uses a continuous neck warp, avoiding hard-cut holes.']}
    (out/'report.json').write_text(json.dumps(report, indent=2))
    return report


def generate(source, output, separation=False):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.is_relative_to(ROOT) or output.exists():
        raise ValueError('A new directory outside Git is required; existing evidence is never overwritten.')
    output.mkdir(parents=True, mode=0o700)
    started = time.monotonic()
    with decode_image(source) as image:
        five = prepare_quality_image(image)
        compatible = output/'five-part'; compatible.mkdir()
        save_preparation(five, compatible)
        # Prove the five improved textures still work with the unchanged writer.
        subprocess.run([shutil.which('node') or 'node', str(ROOT/'scripts/inochi2d/generate.mjs'),
                        str(compatible/'manifest.json'), str(compatible/'model')], check=True,
                        stdout=subprocess.DEVNULL, timeout=40)
        extended = extend_blink_parts(five)
        target = output/'extended'; target.mkdir(); (target/'parts').mkdir()
        for p in extended['manifest']['parts']:
            (target/p['path']).write_bytes(extended['pngs'][p['path']])
        for name, value in [('manifest.json', extended['manifest']), ('preparation-report.json', extended['diagnostics'])]:
            (target/name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        subprocess.run([shutil.which('node') or 'node', str(ROOT/'scripts/inochi2d/quality-model.mjs'),
                        str(target/'manifest.json'), str(target/'model')], check=True,
                        stdout=subprocess.DEVNULL, timeout=40)
        neutral = Image.fromarray(_canvas(five, 'face_base'))
        closed = neutral.copy()
        for side in ('l', 'r'):
            neutral = Image.alpha_composite(neutral, Image.fromarray(_canvas(five, 'eye_white_'+side)))
            closed = Image.alpha_composite(closed, Image.fromarray(_canvas(five, 'eye_closed_'+side)))
        neutral.save(output/'neutral-reconstruction.png'); closed.save(output/'closed-reconstruction.png')
        f = five['diagnostics']['face_box_xywh']; box=(f[0], max(0, f[1]), min(image.width, f[0]+f[2]), min(image.height, f[1]+f[3]))
        closed.crop(box).save(output/'closed-face.png')
        expected = np.array(image); actual=np.array(neutral); visible=actual[:, :, 3]>0
        diff=np.abs(actual[:, :, :3].astype(int)-expected[:, :, :3].astype(int))
        reconstruction={'visible_pixels': int(visible.sum()), 'source_rgb_changed_visible_pixels': int(np.any(diff[visible]>0, axis=1).sum()),
                        'maximum_visible_rgb_delta': int(diff[visible].max()), 'background_alpha_is_inferred': True}
        report={'schema': 1, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'source_size': list(image.size),
            'profile': 'aperture-head-v1', 'file_generation_passed': True, 'official_creator_passed': False,
            'appearance_quality_passed': False, 'manual_points_or_rigging': False, 'external_image_requests': False,
            'unchanged_five_part_export_passed': True, 'reconstruction': reconstruction,
            'automatic_preparation_seconds': five['diagnostics']['elapsed_seconds'],
            'model_sha256': hashlib.sha256((target/'model.inp').read_bytes()).hexdigest(),
            'elapsed_seconds': round(time.monotonic()-started, 3),
            'notes': ['Creator and appearance verdicts require separate evidence for this model hash.',
                'Head motion anchors the torso through a continuous neck deformation; front/back hair is not independently rigged.']}
        if separation:
            report['separation_assessment']=assess_separation(image, five, output)
    report['total_with_assessment_seconds']=round(time.monotonic()-started, 3)
    (output/'trial-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True); parser.add_argument('--output', required=True)
    parser.add_argument('--assess-separation', action='store_true')
    args=parser.parse_args()
    generate(args.source, args.output, args.assess_separation)

"""Private comparison of real serialized models and their CPU blink diagnostics.

No model inference or network access. Does not replace official Creator checks
or certify hidden skin, blur or naturalness. Uses only a new output directory.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('skin_container_reader', Path(__file__).with_name('check-creator-save.py'))
reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)


def compare(trial, output):
    trial, output = Path(trial).resolve(), Path(output).resolve()
    if trial.is_relative_to(ROOT) or output.is_relative_to(ROOT) or output.exists():
        raise ValueError('Use a private trial and a NEW output directory outside Git.')
    report = json.loads((trial / 'skin-boundary-report.json').read_text())
    paths = [trial / 'skin-before/model.inp', trial / 'head/model.inp']
    loaded = [reader.load(p) for p in paths]
    if loaded[0][0] != loaded[1][0]:
        raise ValueError('A skin-only comparison must retain all model nodes, mesh and bindings.')
    if len(loaded[0][1]) != len(loaded[1][1]): raise ValueError('Texture count differs.')
    textures = []
    for i, (a, b) in enumerate(zip(loaded[0][1], loaded[1][1])):
        if a.shape != b.shape or not np.array_equal(a[:, :, 3], b[:, :, 3]):
            raise ValueError('Texture dimensions or alpha differ.')
        delta = np.abs(a.astype(int)-b.astype(int))
        textures.append({'slot': i, 'changed_pixels': int(np.any(delta, axis=2).sum()),
                         'maximum_channel_delta': int(delta.max())})
    output.mkdir(parents=True, mode=0o700)
    before = json.loads((trial / 'skin-before-blink/quality-report.json').read_text())
    after = json.loads((trial / 'blink-quality/quality-report.json').read_text())
    rows = []; sheet = Image.new('RGB', (1560, 5*185), '#d2d2d2'); draw = ImageDraw.Draw(sheet)
    for i, (a, b) in enumerate(zip(before['frames'], after['frames'])):
        if a['opening'] != b['opening']: raise ValueError('Before/after openings differ.')
        pair = []
        for j, folder in enumerate(['skin-before-blink', 'blink-quality']):
            with Image.open(trial / folder / f'blink_{i:02d}.png') as im:
                rgba = np.array(im.convert('RGBA')); pair.append(rgba)
                thumb = im.convert('RGBA'); thumb.thumbnail((380, 150))
                x, y = (i % 2)*780+j*390, (i // 2)*185
                draw.text((x+5, y+5), ('BEFORE' if j == 0 else 'AFTER')+f" open={a['opening']:.3f}", fill='black')
                sheet.paste(thumb, (x+5, y+30), thumb)
        if pair[0].shape != pair[1].shape: raise ValueError('Blink viewports differ.')
        changed = int(np.any(pair[0] != pair[1], axis=2).sum())
        if a['opening'] == 1 and changed: raise ValueError('Neutral source reproduction changed.')
        for state in (a, b):
            if state['transparent_hole_pixels'] or state['closed_iris_residual_pixels']:
                raise ValueError('A blink developed a hole or closed-eye iris residual.')
            if a['opening'] <= .25 and state['central_iris_double_lash_columns']:
                raise ValueError('A low-opening blink developed a second central stroke.')
        rows.append({'opening': a['opening'], 'changed_pixels': changed,
                     'before': a, 'after': b})
    if len(rows) != 10: raise ValueError('Ten matched openings are required.')
    sheet.save(output / '10-opening-before-after.png')
    result = {'format': 'ai-live2d-maker-skin-boundary-model-comparison', 'version': 1,
              'before_model_sha256': hashlib.sha256(paths[0].read_bytes()).hexdigest(),
              'after_model_sha256': hashlib.sha256(paths[1].read_bytes()).hexdigest(),
              'model_structure_mesh_bindings_identical': True, 'stored_alpha_identical': True,
              'textures': textures, 'frames': rows, 'skin_boundary': report,
              'official_runtime_tested_by_this_script': False, 'appearance_quality_passed': False}
    (output / 'comparison-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'output': str(output), 'frames': len(rows), 'changed_texture_slots': [r['slot'] for r in textures if r['changed_pixels']],
                      'neutral_changed_pixels': rows[-1]['changed_pixels']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trial', required=True); parser.add_argument('--output', required=True)
    args = parser.parse_args(); compare(args.trial, args.output)

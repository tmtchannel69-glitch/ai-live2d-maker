"""Small app review images from existing CPU diagnostics, never from the upload.

This adapter does not change model bytes, rigging or the diagnostic renderer.
These are discrete rendered comparisons, not an official/browser runtime.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image

from server.inochi_worker import PreparationFailure

FORMAT = 'ai-live2d-maker-model-review'
MAX_EDGE = 640


def create_review(trial, directory, graph):
    trial, directory = Path(trial), Path(directory)
    blink = json.loads((trial / 'blink-quality/quality-report.json').read_text())
    head = json.loads((trial / 'head-quality/head-quality-report.json').read_text())
    if len(blink.get('frames', [])) != 10 or len(head.get('poses', [])) != 10:
        raise PreparationFailure(422, '動きの比較画像が揃っていません。')
    skin = before = None
    if (trial / 'skin-boundary-report.json').is_file():
        skin = json.loads((trial / 'skin-boundary-report.json').read_text())
        before = json.loads((trial / 'skin-before-blink/quality-report.json').read_text())
        if (skin.get('format') != 'ai-live2d-maker-skin-boundary-correction' or skin.get('version') != 1
                or len(before.get('frames', [])) != 10
                or skin.get('before_model_sha256') != hashlib.sha256((trial / 'skin-before/model.inp').read_bytes()).hexdigest()
                or skin.get('after_model_sha256') != hashlib.sha256((trial / 'head/model.inp').read_bytes()).hexdigest()
                or [f['opening'] for f in blink['frames']] != [f['opening'] for f in before['frames']]):
            raise PreparationFailure(422, '肌境界の改善前後のモデル・開度が一致しません。')
    output = directory / 'review'
    output.mkdir()
    entries = {}

    def thumbnail(source, name):
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(trial.resolve()):
            raise PreparationFailure(422, '動きの比較画像が不足しています。')
        with Image.open(source) as image:
            if image.format != 'PNG' or max(image.size) > 4096 or image.width * image.height > 16_000_000:
                raise PreparationFailure(413, '比較画像のサイズが上限を超えています。')
            image = image.convert('RGBA')
            image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            target = directory / name
            image.save(target)
            size = list(image.size)
        entries[name] = target
        return size

    def view(kind, records):
        frames, size = [], None
        for i, record in enumerate(records):
            name = f'review/{kind}-{i:02d}.png'
            # Source paths are fixed by this adapter, never by a user manifest.
            source = trial / ('blink-quality/blink_%02d.png' % i if kind == 'blink'
                              else 'head-quality/after-' + record['pose'] + '.png')
            if kind == 'head' and record['pose'] not in {
                'neutral', 'shift_left', 'shift_right', 'tilt_left', 'tilt_right',
                'combined_left', 'combined_right', 'opposed_left', 'opposed_right', 'neutral_return'
            }:
                raise PreparationFailure(422, '頭の比較状態が正しくありません。')
            current_size = thumbnail(source, name)
            if size is not None and size != current_size:
                raise PreparationFailure(422, '比較画像のサイズが一致しません。')
            size = current_size
            parameters = ({'EyeOpenL': record['opening'], 'EyeOpenR': record['opening']}
                          if kind == 'blink' else {'HeadX': record['head_x'], 'HeadTilt': record['head_tilt']})
            frames.append({'file': name, 'state': str(record.get('pose', record.get('opening'))),
                           'parameters': parameters, 'diagnostics': record})
            if kind == 'blink' and before is not None:
                before_name = f'review/blink-before-{i:02d}.png'
                if thumbnail(trial / f'skin-before-blink/blink_{i:02d}.png', before_name) != size:
                    raise PreparationFailure(422, '改善前後の比較画像のサイズが一致しません。')
                frames[-1].update(before_file=before_name, before_diagnostics=before['frames'][i])
        return {'id': kind, 'size': size, 'source_roi': blink['source_roi'] if kind == 'blink' else [0, 0, graph['source']['width'], graph['source']['height']],
                'frames': frames}

    review = {'format': FORMAT, 'version': 2 if skin is not None else 1, 'mode': 'detailed-head',
              'renderer': 'independent-cpu-serialized-model',
              'model_sha256': hashlib.sha256((trial / 'head/model.inp').read_bytes()).hexdigest(),
              'source_size': [graph['source']['width'], graph['source']['height']],
              'views': [view('head', head['poses']), view('blink', blink['frames'])],
              'file_generation_passed': True, 'official_creator_tested': False,
              'appearance_quality_passed': False,
              'limitations': ['Discrete CPU-rendered comparisons, not a browser or official runtime.',
                              'Both eyes blink together in the eye comparison; controls are not continuous rigging.',
                              'Hidden shapes, skin blur, lash seams and natural appearance remain unverified.']}
    if skin is not None:
        review['skin_boundary_correction'] = {'report_file': 'skin-boundary-report.json',
                                               'before_model_sha256': skin['before_model_sha256']}
    path = output / 'review.json'
    path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding='utf-8')
    entries['review/review.json'] = path
    return entries

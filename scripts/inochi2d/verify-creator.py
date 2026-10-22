"""Environment-specific official Creator GUI audit, not a general CI test.

Requires the unmodified Creator 0.8.6 on a 1280x960 X11 display with the default
Nodes/Parameters docking. Open the supplied model, close the ordinary donation
notice after its countdown, and leave the three standard controls visible.
Only controls for inspection are changed; no rigging or artwork is edited.
Images/reports must be written outside the repository. See the real-image
validation document for version pins, setup, and the separate quality verdict.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
VIEWPORT = (258, 88, 1170, 900)
CONTROLS = {'EyeOpenL': 173, 'EyeOpenR': 265, 'HeadX': 356}
VALUE_TOP = {'EyeOpenL': 138, 'EyeOpenR': 229, 'HeadX': 320}
POSES = [
    ('neutral', 1, 1, 0), ('left_closed', 0, 1, 0),
    ('right_closed', 1, 0, 0), ('both_closed', 0, 0, 0),
    ('left_half', .5, 1, 0), ('right_half', 1, .5, 0),
    ('both_half', .5, .5, 0), ('head_left', 1, 1, -1),
    ('head_right', 1, 1, 1), ('closed_head_left', 0, 0, -1),
    ('closed_head_right', 0, 0, 1), ('neutral_return', 1, 1, 0),
]


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run_audit(args):
    output = Path(args.output).resolve()
    if output.is_relative_to(ROOT):
        raise ValueError('Screenshots and model reports must be outside Git.')
    output.mkdir(parents=True, exist_ok=False)
    manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    source = ImageOps.exif_transpose(Image.open(args.source)).convert('RGB')
    if source.size != (manifest['source']['width'], manifest['source']['height']):
        raise ValueError('Source dimensions differ from the generated manifest.')
    parts = {p['role']: p for p in manifest['parts']}
    environment = os.environ.copy()
    environment['DISPLAY'] = args.display
    libraries = str(Path(args.xdotool).resolve().parents[1] / 'lib/x86_64-linux-gnu')
    environment['LD_LIBRARY_PATH'] = libraries + ':' + environment.get('LD_LIBRARY_PATH', '')

    def xdo(*arguments):
        return subprocess.check_output([args.xdotool, *map(str, arguments)], env=environment).decode().strip()

    windows = xdo('search', '--onlyvisible', '--name', '^Inochi Creator').splitlines()
    if len(windows) != 1:
        raise ValueError('Exactly one official Creator window is required.')
    window = windows[0]
    title = xdo('getwindowname', window)
    if Path(args.model).name not in title:
        raise ValueError('Creator title does not match the audited model.')
    xdo('windowfocus', '--sync', window)

    def click(x, y, shift=False):
        xdo('mousemove', x, y)
        # SDL/ImGui samples input by frame. Separating motion/modifiers/button
        # edges prevents a busy software-rendering frame using the old point.
        time.sleep(.10)
        if shift:
            xdo('keydown', 'Shift_L')
            time.sleep(.08)
        xdo('mousedown', 1)
        time.sleep(.22)
        xdo('mouseup', 1)
        time.sleep(.08)
        if shift:
            xdo('keyup', 'Shift_L')

    def screenshot():
        data = subprocess.check_output(['import', '-window', 'root', 'png:-'], env=environment)
        image = Image.open(io.BytesIO(data)).convert('RGB')
        if image.size != (1280, 960):
            raise ValueError('This audit requires the documented 1280x960 layout.')
        return image

    def values(image):
        result = {}
        for name, top in VALUE_TOP.items():
            crop = ImageOps.invert(image.crop((130, top, 192, top + 22)).convert('L')).resize((248, 88))
            data = io.BytesIO()
            crop.save(data, 'PNG')
            text = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', '7', '-c',
                                   'tessedit_char_whitelist=0123456789.-'], input=data.getvalue(),
                                  capture_output=True, check=True).stdout.decode().strip()
            if not re.fullmatch(r'-?\d+\.\d+', text):
                raise ValueError(f'Could not verify {name} displayed value: {text!r}')
            result[name] = float(text)
        return result

    def pose(left, right, head):
        for name, value in [('EyeOpenL', left), ('EyeOpenR', right), ('HeadX', head)]:
            x = 173 if value == .5 or name == 'HeadX' and value == 0 else 157 if value <= 0 else 189
            click(x, CONTROLS[name], shift=value != .5)
        xdo('mousemove', 1200, 850)
        time.sleep(.4)

    # At initial fit zoom the reset-to-100% button is at this position. Once
    # already at 100%, this position contains only the position readout.
    click(357, 923)
    time.sleep(.7)
    pose(1, 1, 0)
    neutral = screenshot()
    neutral_values = values(neutral)
    if neutral_values != {'EyeOpenL': 1., 'EyeOpenR': 1., 'HeadX': 0.}:
        raise ValueError(f'Control layout does not match: {neutral_values}')
    eye = parts['eye_white_l']
    x0, y0 = (round(eye['placement'][a] * manifest['source'][b])
              for a, b in [('x', 'width'), ('y', 'height')])
    template = np.array(source.crop((x0 + 5, y0 + 5, x0 + eye['width'] - 5, y0 + eye['height'] - 5)))
    match = cv2.matchTemplate(cv2.cvtColor(np.array(neutral.crop(VIEWPORT)), cv2.COLOR_RGB2GRAY),
                             cv2.cvtColor(template, cv2.COLOR_RGB2GRAY), cv2.TM_CCOEFF_NORMED)
    _, score, _, location = cv2.minMaxLoc(match)
    if score < .95:
        raise ValueError(f'Source eye does not match the native-size Creator view: {score:.4f}')
    origin = (VIEWPORT[0] + location[0] - x0 - 5, VIEWPORT[1] + location[1] - y0 - 5)
    eye_rois = {}
    for side in ('l', 'r'):
        p = parts[f'eye_white_{side}']
        x = round(p['placement']['x'] * source.width) + origin[0]
        y = round(p['placement']['y'] * source.height) + origin[1]
        eye_rois[side] = (x, y, x + p['width'], y + p['height'])
    prep = json.loads((Path(args.manifest).parent / 'preparation-report.json').read_text())
    fx, fy, fw, fh = prep['face_box_xywh']
    face_roi = (max(VIEWPORT[0], fx + origin[0]), max(VIEWPORT[1], fy + origin[1]),
                min(VIEWPORT[2], fx + fw + origin[0]), min(VIEWPORT[3], fy + fh + origin[1]))
    records, faces = [], []
    for name, left, right, head in POSES:
        pose(left, right, head)
        image = screenshot()
        observed = values(image)
        expected = {'EyeOpenL': left, 'EyeOpenR': right, 'HeadX': head}
        if any(abs(observed[key] - value) > (.04 if value == .5 else .005)
               for key, value in expected.items()):
            raise ValueError(f'Parameter control failed at {name}: {observed}')
        image.save(output / f'{name}.png')
        diff = np.abs(np.array(image.crop(VIEWPORT)).astype(int) - np.array(neutral.crop(VIEWPORT)).astype(int))
        eyes = {}
        for side, roi in eye_rois.items():
            pixels = np.array(image.crop(roi)).astype(int)
            before = np.array(neutral.crop(roi)).astype(int)
            iris_color = ((pixels[:, :, 2] - pixels[:, :, 0] > 12)
                          & (pixels[:, :, 2] - pixels[:, :, 1] > 12)
                          & (pixels[:, :, 0] < 180) & (pixels[:, :, 2] < 210))
            eyes[side] = {'changed_pixels': int(np.any(pixels != before, axis=2).sum()),
                          'dark_blue_purple_candidates': int(iris_color.sum())}
        records.append({'pose': name, 'requested': expected, 'displayed': observed,
                        'viewport_changed_pixels': int(np.any(diff > 0, axis=2).sum()),
                        'viewport_max_channel_delta': int(diff.max()), 'eyes': eyes})
        face = image.crop(face_roi)
        face.thumbnail((310, 310))
        faces.append((name, observed, face))
    by_name = {r['pose']: r for r in records}
    assert by_name['left_closed']['eyes']['r']['changed_pixels'] == 0
    assert by_name['right_closed']['eyes']['l']['changed_pixels'] == 0
    assert by_name['left_closed']['eyes']['l']['changed_pixels'] > 0
    assert by_name['right_closed']['eyes']['r']['changed_pixels'] > 0
    assert by_name['head_left']['viewport_changed_pixels'] > 0
    assert by_name['head_right']['viewport_changed_pixels'] > 0
    assert by_name['neutral_return']['viewport_changed_pixels'] == 0
    if args.compare:
        previous = Path(args.compare)
        for record in records:
            before = np.array(Image.open(previous / (record['pose'] + '.png')).crop(VIEWPORT))
            after = np.array(Image.open(output / (record['pose'] + '.png')).crop(VIEWPORT))
            changed = int(np.any(before != after, axis=2).sum())
            record['previous_process_viewport_changed_pixels'] = changed
            assert changed == 0, f'Save/reload changed viewport at {record["pose"]}: {changed}'
    contact = Image.new('RGB', (4 * 320, 3 * 350), '#333333')
    draw = ImageDraw.Draw(contact)
    for i, (name, observed, face) in enumerate(faces):
        x, y = i % 4 * 320, i // 4 * 350
        draw.text((x + 5, y + 5), name, fill='white')
        draw.text((x + 5, y + 20), str(list(observed.values())), fill='white')
        contact.paste(face, (x + 5, y + 38))
    contact.save(output / 'creator-faces-contact.png')
    report = {'schema': 1, 'runtime': 'official Inochi Creator 0.8.6', 'window_title': title,
              'model_sha256': digest(args.model), 'source_sha256': digest(args.source),
              'native_eye_template_correlation': score, 'source_origin_xy': origin,
              'viewport_roi': VIEWPORT, 'face_roi': face_roi, 'eye_rois': eye_rois,
              'poses': records, 'runtime_controls_and_independence_passed': True,
              'previous_process_pixel_identity_passed': bool(args.compare),
              'appearance_quality_passed': False,
              'notes': ['GUI controls test playback states; no manual rigging was performed.',
                        'Near-half control clicks are quantized; displayed values are recorded.',
                        'Color candidates are diagnostics, not proof of natural eyelid artwork.',
                        'HeadX combines whole-foreground translation and planar rotation.',
                        'Linux/Xvfb/Mesa is not a Windows or mobile device verification.']}
    (output / 'creator-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'poses': len(records), 'runtime_passed': True,
                      'save_reload_identity': bool(args.compare)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for required in ('source', 'manifest', 'model', 'output', 'xdotool'):
        parser.add_argument('--' + required, required=True)
    parser.add_argument('--display', default=':94')
    parser.add_argument('--compare', help='Screenshots from the previous Creator process')
    run_audit(parser.parse_args())

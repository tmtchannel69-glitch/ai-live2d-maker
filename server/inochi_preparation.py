"""Local, automatic preparation of five textures for the pinned Inochi trial.

The original SAM endpoint and the known-good Inochi writer are independent of
this experimental adapter. No network request, download, manual point or box is
made here. The closed-eye artwork is an estimate derived from the input lash;
it is not an unseen eye image recovered from the source.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import os
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageOps

from server.engine import ModelUnavailable

ROOT = Path(__file__).resolve().parents[1]
CASCADE_PATH = Path(os.environ.get('INOCHI_ANIMEFACE_CASCADE', ROOT / '.models/animeface/lbpcascade_animeface.xml'))
BACKGROUND_MODEL_PATH = Path(os.environ.get('INOCHI_BACKGROUND_MODEL', ROOT / '.models/models/birefnet-general-lite/birefnet-general-lite.onnx'))
CASCADE_SHA256 = '9376d30ac38db6bda2a68b88b3b76bbd7e6aa33af47f7f5c76bc88ca75f1ce30'
BACKGROUND_SHA256 = '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333'
ROLES = ('face_base', 'eye_white_l', 'eye_white_r', 'eye_closed_l', 'eye_closed_r')
_background_session = None


def check_configuration():
    """Cheap readiness check; does not load weights, hash files or download."""
    missing = [name for name in ('cv2', 'numpy', 'PIL', 'onnxruntime')
               if importlib.util.find_spec(name) is None]
    models = {'animeface': CASCADE_PATH.is_file(), 'birefnet': BACKGROUND_MODEL_PATH.is_file()}
    ready = not missing and all(models.values())
    return {'ready': ready, 'configured': ready,
            'reason': '' if ready else '自動モデル用の追加パッケージかモデルが未配置です。準備手順を確認してください。',
            'missing_packages': missing,
            'models': models, 'automatic_downloads': False, 'external_image_requests': False}


def _verified(path, expected, message):
    if not path.is_file():
        raise ModelUnavailable(message)
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise ModelUnavailable('自動モデル用の検出モデルが正規の内容と一致しません。再配置してください。')


def _detect_face(rgb):
    import cv2
    _verified(CASCADE_PATH, CASCADE_SHA256, '顔検出モデルが未配置です。自動モデル用の準備コマンドを実行してください。')
    cascade = cv2.CascadeClassifier(str(CASCADE_PATH))
    if cascade.empty():
        raise ModelUnavailable('顔検出モデルを読み込めませんでした。')
    # Bound detector work while retaining source-coordinate placements.
    scale = min(1.0, 1200 / max(rgb.shape[:2]))
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else rgb
    gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY))
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(36, 36))
    faces = sorted(faces, key=lambda b: int(b[2]) * int(b[3]), reverse=True)
    if not faces:
        raise ValueError('正面のアニメ顔を自動検出できませんでした。両目の見えるキャラクター1人の画像を選んでください。')
    if len(faces) > 1 and faces[1][2] * faces[1][3] > faces[0][2] * faces[0][3] * .35:
        raise ValueError('複数の顔を検出しました。キャラクター1人の画像を選んでください。')
    box = [int(round(int(v) / scale)) for v in faces[0]]
    if min(box[2:]) < 60:
        raise ValueError('顔が小さく、目の輪郭を安全に分けられません。顔が大きく写った画像を選んでください。')
    return box


def _foreground(source):
    """Reuse the pinned BiRefNet ONNX, retaining original RGB and input alpha."""
    global _background_session
    alpha = source[:, :, 3]
    if np.any(alpha == 0):
        result = source.copy()
        result[alpha == 0] = 0
        return result, 'input-alpha'
    _verified(BACKGROUND_MODEL_PATH, BACKGROUND_SHA256, '背景除去モデルが未配置です。BiRefNet-general-liteを準備してください。')
    import onnxruntime as ort
    ort.disable_telemetry_events()
    if _background_session is None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = min(4, os.cpu_count() or 1)
        options.inter_op_num_threads = 1
        _background_session = ort.InferenceSession(str(BACKGROUND_MODEL_PATH), sess_options=options,
                                                  providers=['CPUExecutionProvider'])
    # Same normalization and output interpretation as the existing rembg
    # BiRefNet adapter. Run directly so missing weights never trigger downloads.
    resized = Image.fromarray(source[:, :, :3]).resize((1024, 1024), Image.Resampling.LANCZOS)
    a = np.asarray(resized, dtype=np.float32)
    a /= max(float(a.max()), 1e-6)
    a = (a - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    tensor = np.transpose(a, (2, 0, 1))[None].astype(np.float32)
    output = _background_session.run(None, {_background_session.get_inputs()[0].name: tensor})[0][0, 0]
    prediction = 1 / (1 + np.exp(-np.clip(output, -80, 80)))
    extent = float(prediction.max() - prediction.min())
    if extent < 1e-8:
        raise ValueError('背景とキャラクターを分離できませんでした。別の画像で再試行してください。')
    prediction = (prediction - prediction.min()) / extent
    mask = Image.fromarray((prediction * 255).astype(np.uint8)).resize((source.shape[1], source.shape[0]), Image.Resampling.LANCZOS)
    inferred = np.asarray(mask, dtype=np.uint8)
    result = source.copy()
    result[:, :, 3] = ((inferred.astype(np.uint16) * alpha.astype(np.uint16) + 127) // 255).astype(np.uint8)
    result[result[:, :, 3] == 0] = 0
    if np.count_nonzero(result[:, :, 3]) < 128:
        raise ValueError('キャラクターの領域が見つかりませんでした。')
    return result, 'birefnet-general-lite-original-rgb'


def _eye_regions(rgb, face):
    """Detect a connected dark iris/lash in each anatomical search region."""
    import cv2
    x, y, w, h = face
    height, width = rgb.shape[:2]
    found = {}
    # A front-facing character's left eye appears on the viewer's right.
    for side, left, right, center in [('r', .08, .47, .29), ('l', .53, .92, .71)]:
        x0, x1 = max(0, int(x + w * left)), min(width, int(x + w * right))
        y0, y1 = max(0, int(y + h * .25)), min(height, int(y + h * .62))
        gray = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
        if not gray.size:
            raise ValueError('目の探索範囲が画像外です。正面の顔全体が入った画像を選んでください。')
        threshold = float(np.clip(np.percentile(gray, 20), 105, 155))
        mask = (gray < threshold).astype(np.uint8)
        kernel = max(1, round(w * .016)) | 1
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((kernel, kernel), np.uint8))
        count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask)
        candidates = []
        for i in range(1, count):
            bx, by, bw, bh, area = (int(v) for v in stats[i])
            cx, cy = centroids[i] + [x0, y0]
            if (bw >= w * .10 and bw <= w * .40 and bh >= max(h * .045, bw * .20) and bh <= h * .25
                    and area >= max(8, w * h * .0015)):
                distance = ((cx - (x + w * center)) / w) ** 2 + ((cy - (y + h * .43)) / h) ** 2
                candidates.append((area / (1 + distance * 100), i))
        if not candidates:
            raise ValueError('左右の開いた目を自動で特定できませんでした。髪で目が隠れていない正面画像を選んでください。')
        _, selected = max(candidates)
        bx, by, bw, bh, area = (int(v) for v in stats[selected])
        # Lower pale iris/white is outside the dark component. Include it with
        # a measured, face-scale margin; do not ask the user to mark anything.
        pad_x, pad_top, pad_bottom = max(2, round(w * .028)), max(2, round(h * .018)), max(3, round(h * .073))
        box = [max(0, x0 + bx - pad_x), max(0, y0 + by - pad_top),
               min(width, x0 + bx + bw + pad_x), min(height, y0 + by + bh + pad_bottom)]
        found[side] = {'box': box, 'dark_box': [x0 + bx, y0 + by, bw, bh],
                       'threshold': threshold, 'dark_pixels': area}
    r, l = found['r']['box'], found['l']['box']
    if r[2] >= l[0] or abs((r[1] + r[3]) - (l[1] + l[3])) > h * .25:
        raise ValueError('左右の目の位置関係を確認できませんでした。正面で両目が開いた画像を選んでください。')
    return found


def _closed_lash(rgb, info):
    """Warp only the input upper-lash ink onto an estimated closed-lid arc."""
    import cv2
    x0, y0, x1, y1 = info['box']
    bx, by, bw, bh = info['dark_box']
    crop = rgb[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    height, width = gray.shape
    out = np.zeros((height, width, 4), np.uint8)
    lash_top = by - y0
    # Keep upper-lash edge, excluding iris by a strict local thickness band.
    thickness = max(1, round(bw * .07))
    target_base = min(height - thickness - 1, lash_top + max(3, round(bh * .80)))
    used_columns = 0
    for xx in range(max(0, bx - x0), min(width, bx - x0 + bw)):
        column = gray[max(0, lash_top - 1):min(height, lash_top + max(3, round(bh * .5))), xx]
        ink = np.where(column < min(125, info['threshold']))[0]
        if not ink.size:
            continue
        original_y = max(0, lash_top - 1) + int(ink[0])
        t = ((xx - (bx - x0)) / max(1, bw - 1)) * 2 - 1
        target_y = int(round(target_base + bw * .065 * (1 - t * t)))
        for dy in range(thickness + 1):
            sy, ty = original_y + dy, target_y + dy
            if sy >= height or ty >= height:
                continue
            # Saturated iris color must never become a "closed eyelash".
            if int(crop[sy, xx].max()) - int(crop[sy, xx].min()) > 45:
                continue
            darkness = max(0.0, min(1.0, (185 - float(gray[sy, xx])) / 90))
            if darkness <= 0:
                continue
            out[ty, xx, :3] = crop[sy, xx]
            out[ty, xx, 3] = round(255 * darkness)
        used_columns += 1
    # A failed extraction is an error, never a transparent/dummy closed eye.
    if used_columns < bw * .55 or np.count_nonzero(out[:, :, 3] > 100) < bw:
        raise ValueError('元画像のまつ毛から閉じた目を作れませんでした。自動まばたきは未対応の画像です。')
    out[out[:, :, 3] == 0] = 0
    return out, {'method': 'input-upper-lash-warp-to-estimated-closed-arc',
                 'ink_columns': used_columns, 'arc_base_y': y0 + target_base,
                 'hidden_artwork_recovered': False, 'naturalness_verified': False}


def _png_part(rgba, role, source_size, box=None, kind='source'):
    height, width = rgba.shape[:2]
    if box is None:
        ys, xs = np.nonzero(rgba[:, :, 3])
        if not len(xs):
            raise ValueError('自動生成した素材が透明です。')
        box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        rgba = rgba[box[1]:box[3], box[0]:box[2]].copy()
    else:
        rgba = rgba.copy()
    rgba[rgba[:, :, 3] == 0] = 0
    h, w = rgba.shape[:2]
    if max(w, h) > 2048:
        raise ValueError('試作モデルの素材は各辺2048pxまでです。画像を2048px以下に縮小して再試行してください。')
    stream = io.BytesIO()
    Image.fromarray(rgba).save(stream, 'PNG')
    sw, sh = source_size
    path = f'parts/{role}.png'
    part = {'role': role, 'path': path, 'width': w, 'height': h,
            'placement': {'x': box[0] / sw, 'y': box[1] / sh,
                          'width': (box[2] - box[0]) / sw, 'height': (box[3] - box[1]) / sh},
            'kind': kind, 'parent': 'head'}
    return part, stream.getvalue()


def prepare_inochi_image(image: Image.Image):
    """One input image -> original five-role manifest, PNG bytes, diagnostics.

    No source-specific coordinates are accepted. Face and eyes must be detected
    anew for every input. ``face_base`` retains the foreground outside the eyes;
    the old five-role rig consequently moves that whole base in this milestone.
    """
    import cv2
    started = time.monotonic()
    oriented = ImageOps.exif_transpose(image)
    width, height = oriented.size
    if min(width, height) < 64 or max(width, height) > 4096 or width * height > 16_000_000:
        raise ValueError('画像は各辺64〜4096px、1600万画素以下にしてください。')
    source = np.array(oriented.convert('RGBA'), copy=True)
    if not source[:, :, 3].any():
        raise ValueError('画像がすべて透明です。')
    # Face detector sees source appearance composited over white, not hidden RGB.
    a = source[:, :, 3:4].astype(np.float32) / 255
    rgb = np.rint(source[:, :, :3] * a + 255 * (1 - a)).astype(np.uint8)
    face = _detect_face(rgb)
    eyes = _eye_regions(rgb, face)
    foreground, foreground_method = _foreground(source)
    fill_mask = np.zeros((height, width), np.uint8)
    restored_eye_alpha_pixels = 0
    for info in eyes.values():
        x0, y0, x1, y1 = info['box']
        fill_mask[y0:y1, x0:x1] = 255
        # An original semi-transparent patch cannot be source-over layered on a
        # filled base without changing its alpha. Preserve user input by
        # rejecting that case rather than silently making the eye opaque.
        if np.any(source[y0:y1, x0:x1, 3] != 255):
            raise ValueError('目の領域に半透明な画素があります。元の透明度を保つため自動補完を中止しました。不透明な目を含む画像を選んでください。')
        if np.mean(foreground[y0:y1, x0:x1, 3] >= 240) < .85:
            raise ValueError('目の周りの不透明な領域が足りず、肌の下地を自動補完できませんでした。')
        # BiRefNet commonly predicts 254 even for solid eye/skin interiors.
        # In detected eyes only, restore the known source alpha (255) before
        # both extraction and base creation. Input RGBA is never modified.
        restored_eye_alpha_pixels += int(np.count_nonzero(foreground[y0:y1, x0:x1, 3] != 255))
        foreground[y0:y1, x0:x1] = source[y0:y1, x0:x1]
    base = foreground.copy()
    # Telea uses surrounding visible colors; it neither calls an image service
    # nor claims to reconstruct hidden skin/anatomy. Open-eye source textures
    # cover this approximation in neutral; closed eyes reveal it.
    filled = cv2.inpaint(source[:, :, :3], fill_mask, max(2, round(face[2] * .035)), cv2.INPAINT_TELEA)
    changed = fill_mask > 0
    base[changed, :3] = filled[changed]
    parts, pngs, closed_diagnostics = [], {}, {}
    part, png = _png_part(base, 'face_base', (width, height), kind='source-with-local-inpaint')
    parts.append(part); pngs[part['path']] = png
    for side in ('l', 'r'):
        info = eyes[side]
        x0, y0, x1, y1 = info['box']
        opened = foreground[y0:y1, x0:x1]
        closed, diagnostics = _closed_lash(source[:, :, :3], info)
        for role, pixels, kind in [(f'eye_white_{side}', opened, 'source'),
                                   (f'eye_closed_{side}', closed, 'estimated-from-source-upper-lash')]:
            part, png = _png_part(pixels, role, (width, height), info['box'], kind)
            parts.append(part); pngs[part['path']] = png
        closed_diagnostics[side] = diagnostics
    # Fixed order is the exact existing CLI/writer contract.
    parts.sort(key=lambda p: ROLES.index(p['role']))
    if sum(p['width'] * p['height'] * 4 for p in parts) > 16 * 1024 * 1024:
        raise ValueError('自動素材の画素量が試作モデルの上限16MiBを超えています。画像を縮小してください。')
    neutral = Image.fromarray(base)
    for side in ('l', 'r'):
        x0, y0, x1, y1 = eyes[side]['box']
        neutral.alpha_composite(Image.fromarray(foreground[y0:y1, x0:x1]), (x0, y0))
    # Composite over opaque white to compare the actual displayed appearance.
    def white_composite(pixels):
        a = pixels[:, :, 3:4].astype(np.float32) / 255
        return np.rint(pixels[:, :, :3] * a + 255 * (1 - a)).astype(np.int16)
    delta = np.abs(white_composite(np.array(neutral)) - white_composite(foreground))
    neutral_rgba_exact = bool(np.array_equal(np.array(neutral), foreground))
    if not neutral_rgba_exact:
        raise ValueError('元画像と通常表示の画素が一致しないため、自動モデルの出力を中止しました。')
    outside = ~changed
    source_preserved = bool(np.array_equal(base[outside], foreground[outside]))
    diagnostics = {
        'schema': 1, 'automatic': True, 'manual_prompts_used': False,
        'external_image_requests': False, 'source_size': [width, height],
        'face_box_xywh': face,
        'eye_regions': eyes,
        'laterality': 'character-left=l=viewer-right; character-right=r=viewer-left',
        'foreground_method': foreground_method,
        'foreground_inference_eye_alpha_restored_pixels': restored_eye_alpha_pixels,
        'foreground_model_sha256': BACKGROUND_SHA256 if foreground_method != 'input-alpha' else None,
        'face_detector_sha256': CASCADE_SHA256,
        'local_fill': {'method': 'opencv-telea', 'pixels': int(changed.sum()),
                       'outside_eye_rgba_unchanged': source_preserved, 'anatomical_reconstruction': False},
        'closed_eyes': closed_diagnostics,
        'neutral_white_composite': {'max_channel_delta': int(delta.max()),
                                    'mean_absolute_channel_delta': float(delta.mean()),
                                    'changed_pixels': int(np.count_nonzero(np.any(delta, axis=2)))},
        'neutral_rgba_exact_to_extracted_foreground': neutral_rgba_exact,
        'quality_status': 'experimental-needs-visual-and-official-runtime-review',
        'limitations': ['front-facing, both eyes open, one character only',
                       'closed eyelids and hidden skin are local estimates',
                       'five-role base contains the remaining foreground; head motion also moves this base',
                       'no broad image-quality or natural-motion guarantee',
                       'Inochi2D only; Live2D Cubism/VTube Studio compatibility unverified'],
        'seconds': round(time.monotonic() - started, 3),
    }
    return {'manifest': {'name': 'automatic-character', 'source': {'width': width, 'height': height},
                         'parts': parts, 'assetLicense': 'User input artwork; rights are separate from software licenses.'},
            'pngs': pngs, 'diagnostics': diagnostics}

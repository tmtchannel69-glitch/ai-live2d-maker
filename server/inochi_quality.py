"""Opt-in local quality experiment; the verified five-part path is unchanged.

Reuses its detections, source ownership, alpha restoration and coordinate
contract. New skin and eyelash pixels are estimates, never recovered artwork.
No networking, source-specific coordinates or user prompts are accepted.
"""
from __future__ import annotations

import copy
import io
import time

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from server.inochi_preparation import prepare_inochi_image, _png_part


def _canvas(prepared, role):
    source = prepared['manifest']['source']
    p = next(p for p in prepared['manifest']['parts'] if p['role'] == role)
    out = np.zeros((source['height'], source['width'], 4), np.uint8)
    x, y = round(p['placement']['x'] * source['width']), round(p['placement']['y'] * source['height'])
    with Image.open(io.BytesIO(prepared['pngs'][p['path']])) as im:
        out[y:y + p['height'], x:x + p['width']] = np.array(im.convert('RGBA'))
    return out


def _skin_field(rgb, mask, info, face):
    """Robust local quadratic from visible warm skin, excluding eyes/hair/ink.

    A low-frequency color field avoids Telea dragging purple hair and eye ink
    across the lid. This deliberately does not invent pores or hidden anatomy.
    Refuse unsupported colors instead of silently using a stock skin patch.
    """
    x0, y0, x1, y1 = info['box']
    pad = max(6, round(face[2] * .16))
    ax, ay = max(0, x0 - pad), max(0, y0 - pad)
    bx, by = min(rgb.shape[1], x1 + pad), min(rgb.shape[0], y1 + pad)
    crop = rgb[ay:by, ax:bx].astype(float)
    r, g, b = crop.transpose(2, 0, 1)
    candidate = ((r > 170) & (b > 100) & (r - g > 3) & (r - b > 3)
                 & (r - b < 75) & (~mask[ay:by, ax:bx]))
    yy, xx = np.indices(candidate.shape)
    sx, sy = (xx + ax - (x0 + x1) / 2) / face[2], (yy + ay - (y0 + y1) / 2) / face[3]
    # Bound memory and keep the fit deterministic regardless of input order.
    sample_y, sample_x = np.nonzero(candidate)
    if len(sample_y) < max(30, face[2] * .2):
        raise ValueError('肌色の根拠が不足し、品質改善用の閉眼下地を推定できませんでした。')
    stride = max(1, len(sample_y) // 6000)
    sample_y, sample_x = sample_y[::stride], sample_x[::stride]
    def basis(x, y):
        return np.stack((np.ones_like(x), x, y, x*x, x*y, y*y), axis=-1)
    design = basis(sx[sample_y, sample_x], sy[sample_y, sample_x])
    colors = crop[sample_y, sample_x]
    distance_weight = 1 / (1 + 80 * (sx[sample_y, sample_x]**2 + sy[sample_y, sample_x]**2))
    weights = distance_weight.copy()
    for _ in range(4):
        weighted = design * weights[:, None]
        coefficients = np.linalg.solve(design.T @ weighted + np.diag([1e-5, .01, .01, .12, .12, .12]),
                                       weighted.T @ colors)
        residual = np.sqrt(np.mean((design @ coefficients - colors)**2, axis=1))
        weights = distance_weight * np.minimum(1, 5 / np.maximum(residual, .01))
    field = basis(sx, sy) @ coefficients
    # Avoid extrapolation outside the measured skin color range.
    low, high = np.percentile(colors, [2, 98], axis=0)
    field = np.clip(field, low - 4, high + 4)
    return np.rint(field).astype(np.uint8), (ax, ay, bx, by), {
        'method': 'robust-visible-skin-quadratic', 'sample_count': len(sample_y),
        'median_sample_residual': float(np.median(residual)),
        'texture_detail_recovered': False,
    }


def _tapered_lash(rgb, info, baseline, side):
    """Input-derived continuous tapered contour, with a measured outer wing."""
    x0, y0, x1, y1 = info['box']
    bx, by, bw, bh = info['dark_box']
    width, height = x1-x0, y1-y0
    crop = rgb[y0:y1, x0:x1]
    gray = np.mean(crop.astype(float), axis=2)
    neutral = np.ptp(crop.astype(int), axis=2) <= 45
    ink = (gray < min(110, info['threshold'])) & neutral
    # The old preparer already checks source lash coverage and continuity.
    xs = np.where(ink[max(0, by-y0-1):min(height, by-y0+round(bh*.5))].any(axis=0))[0]
    xs = xs[(xs >= bx-x0) & (xs < bx-x0+bw)]
    if len(xs) < bw*.55:
        raise ValueError('閉眼のまつ毛を改善するための元の線が不足しています。')
    left, right = float(xs.min()), float(xs.max())
    u = np.linspace(0, 1, max(64, round((right-left)*6)))
    t = 2*u-1
    depth = baseline['curve_depth_pixels']
    cy = (height-1)/2
    y = cy + depth*(1/3-t*t)
    # Reduce the heavy constant-width strap, taper both endpoints. The outer
    # side stays slightly stronger, following the input upper-lash evidence.
    outer = u if side == 'l' else 1-u
    measured_width = baseline['stroke_width_pixels']
    widths = measured_width*.56*(np.sin(np.pi*u)**.55)*(.8+.45*outer)
    x = left+(right-left)*u
    points = list(zip(x, y-widths/2)) + list(zip(x[::-1], (y+widths/2)[::-1]))
    scale = 6
    layer = Image.new('L', (width*scale, height*scale))
    draw = ImageDraw.Draw(layer)
    draw.polygon([(round(px*scale), round(py*scale)) for px, py in points], fill=255)
    # A short tapered wing derives its extent from the detected lash fan;
    # it is a continuation of the same contour, not a separate stock eyelash.
    idx = -1 if side == 'l' else 0
    direction = 1 if side == 'l' else -1
    wing = min(bw*.065, max(1, (width-bw)/2))
    ex, ey = x[idx], y[idx]
    wing_points = [(ex-direction*wing, ey+measured_width*.18),
                   (ex+direction*wing*.5, ey-wing*.7),
                   (ex-direction*wing, ey-measured_width*.23)]
    draw.polygon([(round(px*scale), round(py*scale)) for px, py in wing_points], fill=255)
    out = np.zeros((height, width, 4), np.uint8)
    out[:, :, :3] = baseline['ink_rgb']
    out[:, :, 3] = np.array(layer.resize((width, height), Image.Resampling.LANCZOS))
    out[out[:, :, 3] == 0] = 0
    return out, {**baseline, 'method': 'source-derived-tapered-closed-contour',
                 'maximum_width_pixels': float(widths.max()), 'outer_wing_pixels': wing,
                 'naturalness_verified': False}


def prepare_quality_image(image: Image.Image):
    """Opt-in improved five textures; unchanged detector and neutral pixels."""
    started = time.monotonic()
    prepared = copy.deepcopy(prepare_inochi_image(image))
    source = np.array(ImageOps.exif_transpose(image).convert('RGBA'))
    height, width = source.shape[:2]
    diagnostics = prepared['diagnostics']
    face, eyes = diagnostics['face_box_xywh'], diagnostics['eye_regions']
    base = _canvas(prepared, 'face_base')
    eye_pixels = {side: _canvas(prepared, f'eye_white_{side}') for side in ('l', 'r')}
    mask = eye_pixels['l'][:, :, 3].astype(bool) | eye_pixels['r'][:, :, 3].astype(bool)
    reference = base.copy()
    reference[mask] = source[mask]
    fills = {}
    import cv2
    for side in ('l', 'r'):
        field, (ax, ay, bx, by), fills[side] = _skin_field(source[:, :, :3], mask, eyes[side], face)
        local_mask = eye_pixels[side][ay:by, ax:bx, 3] > 0
        distance = cv2.distanceTransform(local_mask.astype(np.uint8), cv2.DIST_L2, 5)
        blend = np.clip(distance / max(2, face[2]*.012), 0, 1)[:, :, None]
        blended = np.rint(field*blend + base[ay:by, ax:bx, :3]*(1-blend)).astype(np.uint8)
        base[ay:by, ax:bx, :3][local_mask] = blended[local_mask]
        closed, detail = _tapered_lash(source[:, :, :3], eyes[side], diagnostics['closed_eyes'][side], side)
        # Never grow generated lashes outside the original eye ownership.
        x0, y0, x1, y1 = eyes[side]['box']
        closed[~mask[y0:y1, x0:x1]] = 0
        p, png = _png_part(closed, f'eye_closed_{side}', (width, height), eyes[side]['box'],
                           'estimated-source-tapered-lash')
        prepared['pngs'][p['path']] = png
        diagnostics['closed_eyes'][side] = detail
    p, png = _png_part(base, 'face_base', (width, height), kind='source-with-robust-skin-estimate')
    prepared['manifest']['parts'] = [p if old['role'] == 'face_base' else old for old in prepared['manifest']['parts']]
    prepared['pngs'][p['path']] = png
    diagnostics['quality_profile'] = 'skin-lash-v1'
    diagnostics['local_fill'] = {'method': 'robust-visible-skin-quadratic', 'eyes': fills,
                                  'outside_eye_rgba_unchanged': True, 'anatomical_reconstruction': False}
    diagnostics['elapsed_seconds'] = round(time.monotonic()-started, 3)
    # Reconstruct independently from PNGs, rather than trusting the base fit.
    neutral = Image.fromarray(base)
    for side in ('l', 'r'):
        neutral = Image.alpha_composite(neutral, Image.fromarray(eye_pixels[side]))
    # Compare to the old preparer's source-preserving foreground, assembled
    # from the unchanged source/alpha plus the exact source eye ownership.
    if not np.array_equal(np.array(neutral), reference):
        raise ValueError('改善版の通常表示が元の抽出画素と一致しません。')
    diagnostics['neutral_rgba_exact_to_extracted_foreground'] = True
    return prepared


def extend_blink_parts(prepared):
    """Split original upper lashes for an aperture blink; no source resampling.

    Kept outside prepare_quality_image, which still supplies exactly five
    roles usable by the unchanged writer. The extended writer consumes seven.
    """
    out = copy.deepcopy(prepared)
    sw, sh = (out['manifest']['source'][a] for a in ('width', 'height'))
    blink = {}
    for side in ('l', 'r'):
        info = out['diagnostics']['eye_regions'][side]
        x0, y0, x1, y1 = info['box']
        bx, by, bw, bh = info['dark_box']
        original = _canvas(out, f'eye_white_{side}')[y0:y1, x0:x1].copy()
        rgb = original[:, :, :3].astype(int)
        gray = np.mean(rgb, axis=2)
        ink = ((gray < min(110, info['threshold'])) & (np.ptp(rgb, axis=2) <= 45)
               & (original[:, :, 3] > 0))
        xs, ys = [], []
        for x in range(max(0, bx-x0), min(x1-x0, bx-x0+bw)):
            column = np.where(ink[max(0, by-y0-1):min(y1-y0, by-y0+round(bh*.5)), x])[0]
            if len(column):
                xs.append(x); ys.append(max(0, by-y0-1)+int(column[0]))
        if len(xs) < bw*.55:
            raise ValueError('途中のまばたき用の上まつ毛を特定できませんでした。')
        # Smooth only geometry, never the source color pixels.
        fit = np.polyfit((np.array(xs)-(x1-x0)/2)/bw, ys, 3)
        x = np.arange(x1-x0)
        trace = np.polyval(fit, (x-(x1-x0)/2)/bw)
        yy = np.arange(y1-y0)[:, None]
        # Partition every visible pixel exactly once. A thin safety margin
        # includes antialiased lash edges and pixels above the moving contour.
        lash_mask = (yy <= trace[None, :]+max(2, bw*.065)) & (original[:, :, 3] > 0)
        lash = original.copy(); lash[~lash_mask] = 0
        opened = original.copy(); opened[lash_mask] = 0
        for role, pixels in [(f'eye_white_{side}', opened), (f'eye_lash_{side}', lash)]:
            p, png = _png_part(pixels, role, (sw, sh), info['box'], 'source-partition-for-aperture-blink')
            out['pngs'][p['path']] = png
            if role.startswith('eye_lash'):
                out['manifest']['parts'].append(p)
        knots = np.linspace(0, x1-x0-1, 13)
        open_y = np.polyval(fit, (knots-(x1-x0)/2)/bw)
        closed = out['diagnostics']['closed_eyes'][side]
        # The generated closed contour uses the measured ink span.
        cx, half = (min(xs)+max(xs))/2, max(1, (max(xs)-min(xs))/2)
        close_y = (y1-y0-1)/2+closed['curve_depth_pixels']*(1/3-((knots-cx)/half)**2)
        blink[side] = {'upper_y': open_y.tolist(), 'closed_y': close_y.tolist(),
                       'source_lash_partition_pixels': int(lash_mask.sum())}
        # Source-over reconstruction must retain the original RGBA exactly.
        if not np.array_equal(np.array(Image.alpha_composite(Image.fromarray(opened), Image.fromarray(lash))), original):
            raise ValueError('上まつ毛の分離で元画像の画素が変わりました。')
    out['manifest']['quality'] = {'profile': 'aperture-head-v1', 'blink': blink,
        'headPivot': {'x': (out['diagnostics']['face_box_xywh'][0]+out['diagnostics']['face_box_xywh'][2]/2)/sw,
                      'y': (out['diagnostics']['face_box_xywh'][1]+out['diagnostics']['face_box_xywh'][3]*.80)/sh},
        'neckBlend': {'rigidY': (out['diagnostics']['face_box_xywh'][1]+out['diagnostics']['face_box_xywh'][3]*.75)/sh,
                      'fixedY': (out['diagnostics']['face_box_xywh'][1]+out['diagnostics']['face_box_xywh'][3]*.90)/sh}}
    out['diagnostics']['extended_blink'] = blink
    out['diagnostics']['head_motion'] = {'method': 'continuous-neck-weighted-mesh',
        'independent_semantic_head_layers': False, 'front_back_hair_separation': False,
        'torso_fixed_below_normalized_y': out['manifest']['quality']['neckBlend']['fixedY']}
    return out

"""Optional color correction of an existing inferred skin bed, not new artwork.

Preserves observed RGBA, ownership, completion alpha and the old texture detail.
Only a smooth, bounded offset is solved near source-supported skin boundaries.
There is no claim of recovering the true skin hidden behind an open eye.
"""
from __future__ import annotations

import hashlib
import numpy as np

from server.character_parts import decode_asset, png, reconstruct_observed
from server.inochi_quality import _skin_field

PROFILE = 'screened-skin-boundary-v1'
MAX_PIXELS = 131072
SCREEN = .04
MAX_RGB_OFFSET = 12.


def _metrics(field, rgb, pairs):
    if not pairs:
        return {'pairs': 0, 'mean_absolute_rgb_difference': None, 'p95_rgb_difference': None}
    differences = np.concatenate([np.abs(field[y, x] - rgb[ny, nx]).mean(axis=1)
                                  for y, x, ny, nx in pairs])
    return {'pairs': len(differences), 'mean_absolute_rgb_difference': float(differences.mean()),
            'p95_rgb_difference': float(np.percentile(differences, 95))}


def correct_boundary(foreground, prior, target, all_targets, box, face):
    """Solve a screened harmonic *offset*, retaining the prior's local detail."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import cg

    if (foreground.dtype != np.uint8 or foreground.ndim != 3 or foreground.shape[2] != 4
            or prior.shape != foreground.shape or prior.dtype != np.uint8
            or target.shape != foreground.shape[:2] or all_targets.shape != target.shape
            or target.dtype != np.bool_ or all_targets.dtype != np.bool_
            or np.any(target & ~all_targets) or np.any(prior[target, 3] != 255)):
        raise ValueError('肌の境界調整用の画像・対象領域が一致しません。')
    result = prior.copy()
    count = int(target.sum())
    report = {'profile': PROFILE, 'target_pixels': count, 'applied': False,
              'observed_rgba_changed': False, 'completion_alpha_changed': False,
              'hidden_detail_recovered': False, 'appearance_quality_passed': False}
    if not 0 < count <= MAX_PIXELS:
        return result, {**report, 'status': 'no-target' if count == 0 else 'target-budget-exceeded'}
    reference, (ax, ay, bx, by), _ = _skin_field(foreground[:, :, :3], all_targets, {'box': box}, face)
    rgba = foreground[ay:by, ax:bx]
    rgb = rgba[:, :, :3].astype(float)
    r, g, b = rgb.transpose(2, 0, 1)
    known = ((r > 175) & (r-g > 3) & (r-b > 3) & (r-b < 75) & (rgba[:, :, 3] >= 240)
             & ~all_targets[ay:by, ax:bx] & (np.linalg.norm(rgb-reference, axis=2) < 18))
    local = target[ay:by, ax:bx]
    if int(local.sum()) != count or np.any(local[[0, -1]]) or np.any(local[:, [0, -1]]):
        return result, {**report, 'status': 'insufficient-boundary-margin'}
    original = prior[ay:by, ax:bx, :3].astype(float)
    ys, xs = np.nonzero(local)
    ids = np.full(local.shape, -1, int); ids[local] = np.arange(count)
    rows, columns, weights, pairs = [], [], [], []
    rhs = np.zeros((count, 3)); diagonal = np.full(count, SCREEN)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ny, nx = ys+dy, xs+dx
        inside = ids[ny, nx] >= 0
        supported = ~inside & known[ny, nx]
        diagonal += inside | supported
        rows.append(np.arange(count)[inside]); columns.append(ids[ny[inside], nx[inside]])
        weights.append(np.full(int(inside.sum()), -1.))
        # Continue the old fill's one-sided gradient across the boundary. A
        # genuine lighting gradient must not be mistaken for a color seam.
        py, px = ys-dy, xs-dx; opposite = local[py, px]
        extended = original[ys, xs].copy()
        extended[opposite] += original[ys[opposite], xs[opposite]]-original[py[opposite], px[opposite]]
        rhs[supported] += rgb[ny[supported], nx[supported]]-extended[supported]
        if supported.any(): pairs.append((ys[supported], xs[supported], ny[supported], nx[supported]))
    before = _metrics(original, rgb, pairs)
    if before['pairs'] < 12:
        return result, {**report, 'status': 'insufficient-observed-skin-boundary', 'before': before}
    rows.append(np.arange(count)); columns.append(np.arange(count)); weights.append(diagonal)
    matrix = coo_matrix((np.concatenate(weights), (np.concatenate(rows), np.concatenate(columns))),
                        shape=(count, count)).tocsr()
    offsets = []
    for channel in range(3):
        values, info = cg(matrix, rhs[:, channel], rtol=1e-7, atol=1e-6, maxiter=250)
        if info != 0 or not np.isfinite(values).all():
            raise ValueError('肌の境界調整が収束しませんでした。前の出力を保持して停止します。')
        offsets.append(values)
    change = np.column_stack(offsets)
    adjusted = original.copy()
    adjusted[local] = np.rint(np.clip(original[local]+np.clip(change, -MAX_RGB_OFFSET, MAX_RGB_OFFSET), 0, 255))
    after = _metrics(adjusted, rgb, pairs)
    # This is an optional refinement. Never replace an estimate with a worse
    # measured seam or silently present unsupported correction as successful.
    if after['mean_absolute_rgb_difference'] >= before['mean_absolute_rgb_difference']:
        return result, {**report, 'status': 'not-applied-no-measured-improvement', 'before': before,
                        'candidate_after': after}
    result[ay:by, ax:bx, :3][local] = adjusted[local].astype(np.uint8)
    return result, {**report, 'applied': True, 'status': 'measured-boundary-improvement',
                    'source_roi': [ax, ay, bx, by], 'before': before, 'after': after,
                    'changed_pixels': int(np.any(result[target, :3] != prior[target, :3], axis=1).sum()),
                    'screening': SCREEN, 'maximum_allowed_rgb_offset': MAX_RGB_OFFSET,
                    'maximum_solver_offset': float(np.abs(change).max()),
                    'clamped_channels': int((np.abs(change) > MAX_RGB_OFFSET).sum()),
                    'solver_converged': True, 'texture_note': 'Smooth offset only; no added noise or new texture.'}


def refine_eye_skin(graph, assets, face):
    """Return a new graph/assets plus before PNG; never mutate cached inputs."""
    import copy
    import cv2
    from server.parts_quality import inspect_skin
    foreground, _ = reconstruct_observed(graph, assets)
    part = next((p for p in graph['parts'] if p['id'] == 'eye_skin_underpaint'), None)
    if not part or not part['completion']['rgba']:
        raise ValueError('独立した閉眼肌の補完画像がありません。')
    before_bytes = assets[part['completion']['rgba']]
    prior = decode_asset(assets, part['completion']['rgba'])
    all_targets = prior[:, :, 3] > 0
    result = prior.copy(); records = {}
    for side in ('l', 'r'):
        x, y, w, h = graph['motions']['blink'][side]['box_xywh']
        target = np.zeros(all_targets.shape, bool); target[y:y+h, x:x+w] = all_targets[y:y+h, x:x+w]
        adjusted, records[side] = correct_boundary(foreground, prior, target, all_targets,
                                                  [x, y, x+w, y+h], face)
        result[target] = adjusted[target]
    updated_graph, updated_assets = copy.deepcopy(graph), dict(assets)
    after_bytes = before_bytes if np.array_equal(result, prior) else png(result)
    updated_assets[part['completion']['rgba']] = after_bytes
    rgb = foreground[:, :, :3].astype(int)
    reference = ((rgb[:, :, 0]-rgb[:, :, 1] > 5) & (rgb[:, :, 0]-rgb[:, :, 2] > 5)
                 & (rgb.mean(axis=2) > 175) & ~all_targets)
    nearby = cv2.dilate(all_targets.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool) & reference
    inner = cv2.erode(all_targets.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    clean = cv2.erode(nearby.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    report = {'format': 'ai-live2d-maker-skin-boundary-correction', 'version': 1, 'profile': PROFILE,
              'source_size': [graph['source']['width'], graph['source']['height']], 'eyes': records,
              'before_png_sha256': hashlib.sha256(before_bytes).hexdigest(),
              'after_png_sha256': hashlib.sha256(after_bytes).hexdigest(),
              'skin_detail': {'before': inspect_skin(prior[:, :, :3], foreground[:, :, :3], inner, clean),
                              'after': inspect_skin(result[:, :, :3], foreground[:, :, :3], inner, clean)},
              'observed_rgba_changed': False, 'completion_mask_or_alpha_changed': False,
              'manual_prompts': False, 'external_image_requests': False,
              'official_creator_tested': False, 'appearance_quality_passed': False}
    updated_graph['diagnostics']['skin_boundary_correction'] = report
    return updated_graph, updated_assets, before_bytes, report

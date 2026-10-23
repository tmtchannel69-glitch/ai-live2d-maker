"""Engine-independent, source-coordinate character parts and separate completion.

Observed ownership, inferred pixels and output-specific flattening are different
concepts. Neither a runtime node number nor a material license is inferred here.
"""
from __future__ import annotations

import io
import re

import numpy as np
from PIL import Image

FORMAT = 'ai-live2d-maker-character-parts'
VERSION = 1
MAX_DECODED_BYTES = 128 * 1024 * 1024
EYE_ROLES = ('upper_lid', 'lower_lid', 'eyelash_upper', 'eyelash_lower',
             'sclera', 'iris', 'pupil', 'highlight', 'context')


def png(pixels):
    stream = io.BytesIO()
    Image.fromarray(pixels).save(stream, 'PNG')
    return stream.getvalue()


def new_graph(width, height):
    return {'format': FORMAT, 'version': VERSION, 'source': {'width': width, 'height': height},
        'coordinates': 'source-pixels-top-left; placement=source-normalized',
        'laterality': 'character-left=l=viewer-right', 'parts': [],
        'groups': [{'id': 'root', 'parent': None}, {'id': 'head', 'parent': 'root'},
                   {'id': 'eye_l', 'parent': 'head'}, {'id': 'eye_r', 'parent': 'head'},
                   {'id': 'hair', 'parent': 'head'},
                   *[{'id':'hair_'+r,'parent':'hair'} for r in ('front','side_l','side_r','back')]],
        'neutral_policy': 'observed-only; completions-require-explicit-exposure-policy',
        'external_image_requests': False, 'manual_prompts': False,
        'confidence_interpretation': 'heuristic evidence score; not a calibrated probability',
        'appearance_quality_passed': False, 'assets': {}}


def add_part(graph, assets, *, part_id, role, pixels, mask, box, parent, order,
             side=None, confidence=.5, method='', status='recognized', completion=None,
             completion_mask=None, occluded_by=(), motion=None):
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,70}', part_id) or any(p['id'] == part_id for p in graph['parts']):
        raise ValueError('Invalid or duplicate common part ID.')
    x, y, width, height = map(int, box)
    sw, sh = graph['source']['width'], graph['source']['height']
    if (width <= 0 or height <= 0 or x < 0 or y < 0 or x+width > sw or y+height > sh
            or pixels.shape != (height, width, 4) or mask.shape != (height, width)):
        raise ValueError('Common part coordinates or mask dimensions differ.')
    visible = mask & (pixels[:, :, 3] > 0)
    path = mask_path = None
    if visible.any():
        observed = pixels.copy(); observed[~visible] = 0
        path, mask_path = f'observed/{part_id}.png', f'masks/{part_id}_observed.png'
        assets[path] = png(observed); assets[mask_path] = png(visible.astype(np.uint8)*255)
    elif status == 'recognized':
        status = 'missing'
    completion_path = completion_mask_path = None
    generated = 0
    if completion is not None and completion_mask is not None:
        if completion.shape != pixels.shape or completion_mask.shape != mask.shape or np.any(completion_mask & visible):
            raise ValueError('Completion must occupy separate, previously unobserved pixels.')
        target = completion_mask & (completion[:, :, 3] > 0)
        generated = int(target.sum())
        if generated:
            inferred = completion.copy(); inferred[~target] = 0
            completion_path, completion_mask_path = f'completion/{part_id}.png', f'masks/{part_id}_completion.png'
            assets[completion_path] = png(inferred); assets[completion_mask_path] = png(target.astype(np.uint8)*255)
    part = {'id': part_id, 'role': role, 'side': side, 'parent': parent, 'order': order,
        'source_box_xywh': [x, y, width, height],
        'placement': {'x': x/sw, 'y': y/sh, 'width': width/sw, 'height': height/sh},
        'observed': {'rgba': path, 'mask': mask_path, 'pixels': int(visible.sum()), 'source_rgb_preserved': True},
        'completion': {'rgba': completion_path, 'mask': completion_mask_path, 'pixels': generated,
                       'status': 'estimated' if generated else 'not-generated', 'anatomy_recovered': False,
                       'enabled_in_neutral': False},
        'occluded_by': list(occluded_by),
        'recognition': {'status': status, 'confidence': float(np.clip(confidence, 0, 1)), 'method': method},
        'motion': motion or {'kind': 'unspecified', 'validated': False}}
    graph['parts'].append(part)
    return part


def decode_asset(assets, path):
    with Image.open(io.BytesIO(assets[path])) as image:
        return np.array(image.convert('RGBA'))


def validate_graph(graph, assets):
    if graph.get('format') != FORMAT or graph.get('version') != VERSION:
        raise ValueError('Unsupported common character-parts version.')
    ids = {p['id'] for p in graph['parts']}; groups = {g['id'] for g in graph['groups']}
    if len(ids) != len(graph['parts']) or ids & groups or len(ids) > 80:
        raise ValueError('Invalid common part IDs or count.')
    parents = {g['id']: g['parent'] for g in graph['groups']}
    parents.update({p['id']: p['parent'] for p in graph['parts']})
    for key in parents:
        seen = set(); current = key
        while current is not None:
            if current in seen or current not in parents:
                raise ValueError('Unknown or cyclic part parent.')
            seen.add(current); current = parents[current]
    decoded = 0
    for p in graph['parts']:
        x,y,w,h=p['source_box_xywh'];sw,sh=graph['source']['width'],graph['source']['height']
        if any(type(v) is not int for v in (x,y,w,h)) or min(x,y)<0 or min(w,h)<=0 or x+w>sw or y+h>sh:
            raise ValueError('Invalid common part source placement.')
        if any(key not in ids for key in p['occluded_by']):
            raise ValueError('Unknown occluding part.')
        section_masks={}
        for section in ('observed', 'completion'):
            data = p[section]
            if data['pixels'] == 0:
                if data['rgba'] is not None or data['mask'] is not None:
                    raise ValueError('Missing parts must not use dummy PNG assets.')
                continue
            for path in (data['rgba'], data['mask']):
                if not isinstance(path, str) or not re.fullmatch(r'(observed|completion|masks)/[a-z0-9_]+\.png', path) or path not in assets:
                    raise ValueError('Invalid common asset path.')
                with Image.open(io.BytesIO(assets[path])) as im:
                    if im.size != (w, h):
                        raise ValueError('Common asset dimensions differ from placement.')
                    decoded += w*h*(4 if path == data['rgba'] else 1)
            if decoded > MAX_DECODED_BYTES:
                raise ValueError('Common part decoded budget exceeded.')
            rgba=decode_asset(assets,data['rgba'])
            with Image.open(io.BytesIO(assets[data['mask']])) as im:
                alpha=np.array(im.convert('L'))>0
            if not np.array_equal(alpha,rgba[:,:,3]>0) or int(alpha.sum())!=data['pixels']:
                raise ValueError('Stored common mask/pixel count differs from RGBA ownership.')
            section_masks[section]=alpha
        if 'observed' in section_masks and 'completion' in section_masks and np.any(section_masks['observed']&section_masks['completion']):
            raise ValueError('Observed pixels overlap their own completion.')
    graph['decoded_asset_bytes'] = decoded
    return True


def reconstruct_observed(graph, assets):
    """Independent ownership check; completions do not hide missing source."""
    sw, sh = graph['source']['width'], graph['source']['height']
    pixels = np.zeros((sh, sw, 4), np.uint8)
    owners = np.zeros((sh, sw), np.uint8)
    for p in graph['parts']:
        if p['observed']['rgba'] is None:
            continue
        x, y, w, h = p['source_box_xywh']; a = decode_asset(assets, p['observed']['rgba'])
        mask = a[:, :, 3] > 0
        owners[y:y+h, x:x+w][mask] += 1
        pixels[y:y+h, x:x+w][mask] = a[mask]
    if np.any(owners > 1):
        raise ValueError('Observed pixels have overlapping owners.')
    return pixels, owners

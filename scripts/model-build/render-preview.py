#!/usr/bin/env python3
"""Render bounded diagnostic PNGs through a separately built PurismCore runtime.

Original harness; no official Live2D SDK, Core or third-party image assets included.
Reference runtime: https://github.com/SakuraMotion/PurismCore (MIT), commit
1069334965522df5d0b791e97f01e26b19c45456. The separate runtime retains its license.
This is a nearest-neighbor CPU diagnostic renderer, not a VTube Studio/Cubism
compatibility check, a naturalness assessment or a physics simulator. Only load a
trusted locally built shared library. User images/output must remain outside Git.
"""
import argparse
import ctypes as C
import importlib.util
import json
import math
import os
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

MIB = 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024  # uint8 RGBA: 64 MiB, including four 2048px atlases
MAX_TRIANGLES = 100_000
MAX_DRAWABLES = 256
MAX_RASTER_WORK = 120_000_000
POSE_SETS = {
    'default': (
        ('default', {}), ('left-closed', {'ParamEyeLOpen': 0}),
        ('right-closed', {'ParamEyeROpen': 0}),
        ('both-closed', {'ParamEyeLOpen': 0, 'ParamEyeROpen': 0}),
        ('mouth-open', {'ParamMouthOpenY': 1}),
        ('head-left', {'ParamAngleX': -10}), ('head-right', {'ParamAngleX': 10}),
    ),
    'expressions': (
        ('default', {}), ('left-closed', {'ParamEyeLOpen': 0}),
        ('left-half', {'ParamEyeLOpen': .5}),
        ('right-closed', {'ParamEyeROpen': 0}),
        ('right-half', {'ParamEyeROpen': .5}),
        ('both-closed', {'ParamEyeLOpen': 0, 'ParamEyeROpen': 0}),
        ('both-half', {'ParamEyeLOpen': .5, 'ParamEyeROpen': .5}),
        ('mouth-half', {'ParamMouthOpenY': .5}),
        ('mouth-open', {'ParamMouthOpenY': 1}),
        ('both-closed-mouth-open', {'ParamEyeLOpen': 0, 'ParamEyeROpen': 0,
                                    'ParamMouthOpenY': 1}),
    ),
    # Dense low-opening samples expose double outlines that endpoint/halfway
    # images can miss. Keep the bounded ten-frame budget; baseline explicitly
    # requests fully open eyes rather than assuming the model's defaults are 1.
    'blink-transitions': tuple(
        (label, {'ParamEyeLOpen': value, 'ParamEyeROpen': value})
        for label, value in (
            ('default', 1), ('both-closed', 0), ('both-025', .025),
            ('both-05', .05), ('both-075', .075), ('both-10', .1),
            ('both-15', .15), ('both-25', .25), ('both-half', .5),
            ('both-75', .75),
        )
    ),
}


class PreviewError(Exception):
    pass


def require(ok, message):
    if not ok:
        raise PreviewError(message)


def reference(root, value):
    require(isinstance(value, str) and 0 < len(value) <= 240,
            'invalid model reference')
    require(not any(c in value for c in '\\:\x00?#') and
            not any(ord(c) < 32 for c in value) and
            not value.startswith('/') and
            all(p not in ('', '.', '..') for p in value.split('/')),
            'model reference must be a relative local path')
    path = root
    for part in value.split('/'):
        path = path / part
        require(not path.is_symlink(), 'model references cannot contain symlinks')
    require(path.resolve().is_relative_to(root) and path.is_file(),
            'model reference is missing or outside its directory')
    return path


def load_inputs(model):
    require(model.is_file() and not model.is_symlink() and
            model.name.endswith('.model3.json') and model.stat().st_size <= 256*1024,
            'a local model3.json of at most 256 KiB is required')
    root = model.parent.resolve()
    metadata = json.loads(model.read_text(encoding='utf-8'))
    require(metadata.get('Version') == 3 and isinstance(metadata.get('FileReferences'), dict),
            'model3 Version 3 and FileReferences are required')
    refs = metadata['FileReferences']
    moc = reference(root, refs.get('Moc'))
    names = refs.get('Textures')
    require(isinstance(names, list) and 0 < len(names) <= 16, '1..16 textures required')
    textures, pixels, compressed = [], 0, 0
    for name in names:
        path = reference(root, name)
        compressed += path.stat().st_size
        require(path.stat().st_size <= 32*MIB and compressed <= 100*MIB,
                'texture file byte limit exceeded')
        with Image.open(path) as image:
            require(image.format == 'PNG' and 0 < image.width <= 4096 and
                    0 < image.height <= 4096, 'bounded PNG textures are required')
            pixels += image.width * image.height
            require(pixels <= MAX_PIXELS, 'decoded texture pixel limit exceeded')
            textures.append(np.asarray(image.convert('RGBA'), dtype=np.uint8).copy())
    return moc, textures


class Runtime:
    class V2(C.Structure):
        _fields_ = [('x', C.c_float), ('y', C.c_float)]

    class V4(C.Structure):
        _fields_ = [('x', C.c_float), ('y', C.c_float), ('z', C.c_float), ('w', C.c_float)]

    def __init__(self, library, mocpath):
        # Reuse the separately tested strict consistency/extrema checks. The
        # module path is fixed to this application's own source, never an upload.
        spec = importlib.util.spec_from_file_location(
            'model_build_runtime_validator', Path(__file__).with_name('validate-runtime.py'))
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        try:
            self.validation = validator.validate(library, mocpath)
        except validator.ValidationError as error:
            raise PreviewError(str(error)) from error
        require(self.validation['drawable_count'] <= MAX_DRAWABLES and
                self.validation['index_count']//3 <= MAX_TRIANGLES and
                self.validation['vertex_count'] <= 200_000,
                'model exceeds diagnostic renderer geometry limit')
        self.lib = C.CDLL(str(library.resolve()))
        P, I, F = C.c_void_p, C.c_int, C.c_float
        function = self.function
        raw = mocpath.read_bytes()
        self.moc_owner, ptr = validator.aligned(len(raw), 64)
        C.memmove(ptr, raw, len(raw))
        moc = function('csmReviveMocInPlace', [P, C.c_uint], P)(ptr, len(raw))
        require(bool(moc), 'runtime could not revive model for rendering')
        size = function('csmGetSizeofModel', [P], C.c_uint)(moc)
        require(0 < size <= 256*MIB, 'model allocation limit exceeded')
        self.model_owner, ptr = validator.aligned(size, 16)
        self.model = function('csmInitializeModelInPlace', [P, P, C.c_uint], P)(moc, ptr, size)
        require(bool(self.model), 'runtime initialization failed')
        self.update = function('csmUpdateModel', [P], None)
        self.values = function('csmGetParameterValues', [P], C.POINTER(F))(self.model)
        self.parameters = self.validation['parameters']
        self.count = self.validation['drawable_count']
        self.vertex_counts = function('csmGetDrawableVertexCounts', [P], C.POINTER(I))(self.model)
        self.positions = function('csmGetDrawableVertexPositions', [P], C.POINTER(C.POINTER(self.V2)))
        self.uvs = function('csmGetDrawableVertexUvs', [P], C.POINTER(C.POINTER(self.V2)))
        self.opacity = function('csmGetDrawableOpacities', [P], C.POINTER(F))
        self.orders = function('csmGetDrawableDrawOrders', [P], C.POINTER(I))
        self.dynamic = function('csmGetDrawableDynamicFlags', [P], C.POINTER(C.c_ubyte))
        self.multiply = function('csmGetDrawableMultiplyColors', [P], C.POINTER(self.V4))
        self.screen = function('csmGetDrawableScreenColors', [P], C.POINTER(self.V4))
        counts = function('csmGetDrawableIndexCounts', [P], C.POINTER(I))(self.model)
        indices = function('csmGetDrawableIndices', [P], C.POINTER(C.POINTER(C.c_ushort)))(self.model)
        texture = function('csmGetDrawableTextureIndices', [P], C.POINTER(I))(self.model)
        flags = function('csmGetDrawableConstantFlags', [P], C.POINTER(C.c_ubyte))(self.model)
        mask_counts = function('csmGetDrawableMaskCounts', [P], C.POINTER(I))(self.model)
        masks = function('csmGetDrawableMasks', [P], C.POINTER(C.POINTER(I)))(self.model)
        names = function('csmGetDrawableIds', [P], C.POINTER(C.c_char_p))(self.model)
        self.static = []
        for i in range(self.count):
            require(0 <= mask_counts[i] <= self.count, 'invalid drawable mask count')
            require(not mask_counts[i] or bool(masks[i]), 'missing drawable masks')
            mask = [masks[i][j] for j in range(mask_counts[i])]
            require(all(0 <= j < self.count for j in mask), 'mask index exceeds range')
            require(not flags[i] & 3, 'additive/multiplicative blend modes are unsupported')
            self.static.append({'id': names[i].decode('utf-8'), 'texture': texture[i],
                                'flags': flags[i], 'masks': mask,
                                'indices': np.array([indices[i][j] for j in range(counts[i])],
                                                    dtype=np.int32).reshape(-1, 3)})
        require(not any(self.static[k]['masks'] for d in self.static for k in d['masks']),
                'nested clipping masks are unsupported by this diagnostic renderer')

    def function(self, name, arguments, result):
        f = getattr(self.lib, name)
        f.argtypes, f.restype = arguments, result
        return f

    def pose(self, overrides):
        known = {p['id'] for p in self.parameters}
        for i, p in enumerate(self.parameters):
            self.values[i] = max(p['min'], min(p['max'], overrides.get(p['id'], p['default'])))
        self.update(self.model)
        points, uvs, opacity = self.positions(self.model), self.uvs(self.model), self.opacity(self.model)
        orders, visible = self.orders(self.model), self.dynamic(self.model)
        multiply, screen = self.multiply(self.model), self.screen(self.model)
        result = []
        for i, item in enumerate(self.static):
            require(all(math.isfinite(v) for v in [opacity[i], multiply[i].x, multiply[i].y,
                    multiply[i].z, screen[i].x, screen[i].y, screen[i].z]), 'invalid runtime color')
            pos = np.array([[points[i][k].x, points[i][k].y]
                            for k in range(self.vertex_counts[i])], dtype=np.float64)
            uv = np.array([[uvs[i][k].x, uvs[i][k].y]
                           for k in range(self.vertex_counts[i])], dtype=np.float64)
            require(np.isfinite(pos).all() and np.isfinite(uv).all(), 'nonfinite pose geometry')
            result.append({**item, 'positions': pos, 'uv': uv, 'order': orders[i],
                           'opacity': float(np.clip(opacity[i], 0, 1)) if visible[i] & 1 else 0,
                           'multiply': np.array([multiply[i].x, multiply[i].y, multiply[i].z]),
                           'screen': np.array([screen[i].x, screen[i].y, screen[i].z])})
        return result, sorted(set(overrides)-known)


def bounds(poses, face_box=None):
    all_points = np.concatenate([d['positions'] for p in poses.values() for d in p])
    low, high = all_points.min(0), all_points.max(0)
    require(np.all(high-low > 0), 'empty model bounds')
    if face_box:
        l, t, r, b = face_box
        require(all(math.isfinite(x) for x in face_box) and 0 <= l < r <= 1 and
                0 <= t < b <= 1, 'face box must be normalized left/top/right/bottom')
        size = high-low
        return (np.array([low[0]+l*size[0], high[1]-b*size[1]]),
                np.array([low[0]+r*size[0], high[1]-t*size[1]])), 'explicit-normalized-model-bounds'
    matches = [d['positions'] for p in poses.values() for d in p if
               'face' in d['id'].lower() and 'detail' not in d['id'].lower()]
    if matches:
        points = np.concatenate(matches)
        lo, hi = points.min(0), points.max(0)
        if np.all(hi-lo > 0):
            pad = (hi-lo)*.12
            return (lo-pad, hi+pad), 'face-drawable-ID-bounds'
    size = high-low
    return (np.array([low[0], high[1]-.3*size[1]]), high.copy()), 'heuristic-upper-30-percent'


def raster(draws, textures, region, width, height):
    low, high = region
    span = high-low
    require(np.all(span > 0), 'invalid rendering range')
    scale = min((width-12)/span[0], (height-12)/span[1])
    offset = np.array([(width-span[0]*scale)/2, (height-span[1]*scale)/2])
    work = 0

    def layer(d):
        nonlocal work
        require(0 <= d['texture'] < len(textures), 'drawable texture index exceeds supplied textures')
        out = np.zeros((height, width, 4), dtype=np.float32)
        if not d['opacity']:
            return out
        v = (d['positions']-low)*scale+offset
        v[:, 1] = height-v[:, 1]
        uv, tex = d['uv'], textures[d['texture']]
        th, tw = tex.shape[:2]
        for tri in d['indices']:
            a, b, c = v[tri]
            den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den) < 1e-12:
                continue
            mn = np.maximum(np.floor(v[tri].min(0)), [0, 0])
            mx = np.minimum(np.ceil(v[tri].max(0)), [width-1, height-1])
            if np.any(mx < mn):
                continue
            mn, mx = mn.astype(int), mx.astype(int)
            work += int((mx[0]-mn[0]+1)*(mx[1]-mn[1]+1))
            require(work <= MAX_RASTER_WORK, 'raster work limit exceeded')
            yy, xx = np.mgrid[mn[1]:mx[1]+1, mn[0]:mx[0]+1]
            xx, yy = xx+.5, yy+.5
            w0 = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            w1 = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
            w2 = 1-w0-w1
            inside = (w0 >= -1e-7) & (w1 >= -1e-7) & (w2 >= -1e-7)
            u = w0*uv[tri[0], 0]+w1*uv[tri[1], 0]+w2*uv[tri[2], 0]
            vv = w0*uv[tri[0], 1]+w1*uv[tri[1], 1]+w2*uv[tri[2], 1]
            tx = (np.clip(u, 0, 1)*(tw-1)).round().astype(int)
            ty = (np.clip(1-vv, 0, 1)*(th-1)).round().astype(int)
            color = tex[ty[inside], tx[inside]].astype(np.float32)/255
            color[:, :3] *= d['multiply']
            color[:, :3] = color[:, :3]+d['screen']-color[:, :3]*d['screen']
            out[mn[1]:mx[1]+1, mn[0]:mx[0]+1][inside] = color
        out[:, :, 3] *= d['opacity']
        return out

    mask_ids = {i for d in draws for i in d['masks']}
    require(len(mask_ids)*width*height <= 16_000_000, 'clipping image memory limit exceeded')
    # Copy the alpha channel so each mask does not retain its full RGBA array.
    alpha_masks = {i: layer(draws[i])[:, :, 3].copy() for i in mask_ids}
    canvas = np.zeros((height, width, 4), dtype=np.float32)
    for d in sorted(draws, key=lambda item: item['order']):
        src = layer(d)
        if d['masks']:
            mask = np.ones((height, width), dtype=np.float32)
            for i in d['masks']:
                mask *= 1-alpha_masks[i]
            mask = 1-mask
            if d['flags'] & 8:
                mask = 1-mask
            src[:, :, 3] *= mask
        alpha = src[:, :, 3:4]
        # Premultiplied accumulation avoids division/rounding at every layer.
        canvas[:, :, :3] = src[:, :, :3]*alpha+canvas[:, :, :3]*(1-alpha)
        canvas[:, :, 3:4] = alpha+canvas[:, :, 3:4]*(1-alpha)
    canvas[:, :, :3] = np.divide(canvas[:, :, :3], canvas[:, :, 3:4],
                                out=np.zeros_like(canvas[:, :, :3]), where=canvas[:, :, 3:4] > 0)
    return np.clip(canvas*255, 0, 255).round().astype(np.uint8)


def comparison(images, background):
    width, height = next(iter(images.values())).size
    columns = min(4, len(images))
    rows = (len(images)+columns-1)//columns
    output = Image.new('RGB', (columns*width, rows*(height+24)), '#242432')
    draw = ImageDraw.Draw(output)
    for index, (name, image) in enumerate(images.items()):
        x, y = index % columns*width, index//columns*(height+24)
        if background == 'checker':
            for py in range(0, height, 16):
                for px in range(0, width, 16):
                    color = '#606070' if (px//16+py//16) % 2 else '#303040'
                    draw.rectangle((x+px, y+24+py, x+min(px+15, width-1),
                                    y+24+min(py+15, height-1)), fill=color)
        else:
            draw.rectangle((x, y+24, x+width-1, y+height+23), fill=background)
        output.paste(image, (x, y+24), image)
        draw.text((x+5, y+5), name, fill='white')
    return output


def render(arguments):
    require(128 <= arguments.height <= 768, 'height must be 128..768')
    output = arguments.output.resolve()
    require(not output.exists(), 'output directory must be new; refusing to overwrite')
    repo = Path(__file__).resolve().parents[2]
    require(not output.is_relative_to(repo), 'derived images must be outside the application Git checkout')
    moc, textures = load_inputs(arguments.model)
    runtime = Runtime(arguments.library, moc)
    pose_set = arguments.poses
    specs = POSE_SETS[pose_set]
    poses, missing = {}, {}
    for label, override in specs:
        poses[label], absent = runtime.pose(override)
        if absent:
            missing[label] = absent
    all_points = np.concatenate([d['positions'] for p in poses.values() for d in p])
    low, high = all_points.min(0), all_points.max(0)
    span = high-low
    require(np.all(span > 0), 'empty model area')
    width = max(128, min(768, round(arguments.height*span[0]/span[1])))
    common = (low, high)
    face, face_kind = bounds(poses, arguments.face_box)
    output.mkdir(mode=0o700)
    stats = {}
    for prefix, region, w, h in [('full', common, width, arguments.height),
                                 ('face', face, min(512, arguments.height), min(512, arguments.height))]:
        arrays, images = {}, {}
        for label, draws in poses.items():
            arrays[label] = raster(draws, textures, region, w, h)
            images[label] = Image.fromarray(arrays[label])
            images[label].save(output / f'{prefix}-{label}.png')
        baseline = arrays['default']
        stats[prefix] = {label: {'changed_pixels_from_default': int(np.any(a != baseline, axis=2).sum()),
                                  'visible_pixels': int((a[:, :, 3] > 0).sum()),
                                  'skipped_parameter_ids': missing.get(label, [])}
                         for label, a in arrays.items()}
        for background in ['checker', 'white', 'black']:
            comparison(images, background).save(output / f'{prefix}-comparison-{background}.png')
    ranges = {p['id']: {'min': p['min'], 'max': p['max'], 'default': p['default']}
              for p in runtime.parameters}
    applied = {label: {key: max(ranges[key]['min'], min(ranges[key]['max'], value))
                       for key, value in override.items() if key in ranges}
               for label, override in specs}
    report = {'format': 'ai-live2d-independent-cpu-preview', 'version': 1,
              'pose_set': pose_set,
              'model_sha256': runtime.validation['model_sha256'],
              'runtime': runtime.validation['runtime'], 'runtime_commit': runtime.validation['reference_runtime_commit'],
              'official_core_tested': False, 'vtube_studio_tested': False,
              'physics_simulated': False, 'natural_quality_confirmed': False,
              'nearest_neighbor_diagnostic_rendering': True,
              'common_world_bounds': [low.tolist(), high.tolist()],
              'face_bounds': [face[0].tolist(), face[1].tolist()], 'face_selection': face_kind,
              'poses': {label: values for label, values in specs},
              'applied_pose_values': applied, 'parameter_ranges': ranges, 'stats': stats,
              'warnings': ['No official Core/VTube Studio validation.',
                           'Nearest-neighbor sampling; no antialiasing or physics. Missing IDs are skipped; requested values are clamped to model parameter ranges.',
                           'Face crop from drawable IDs/heuristic is not face detection.']}
    (output / 'preview-report.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', required=True, type=Path)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--height', type=int, default=384)
    parser.add_argument('--poses', choices=tuple(POSE_SETS), default='default',
                        help='bounded diagnostic pose preset (default: %(default)s)')
    parser.add_argument('--face-box', type=float, nargs=4, metavar=('LEFT', 'TOP', 'RIGHT', 'BOTTOM'))
    arguments = parser.parse_args()
    sys.stdout.flush()
    saved = os.dup(1)
    os.dup2(2, 1)
    try:
        report = render(arguments)
    except (PreviewError, OSError, ValueError, AttributeError, UnicodeError, Image.DecompressionBombError) as error:
        print(f'Preview failed: {error}', file=sys.stderr)
        return 1
    finally:
        try:
            C.CDLL(None).fflush(None)
        except (OSError, AttributeError):
            pass
        os.dup2(saved, 1)
        os.close(saved)
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())

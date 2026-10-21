#!/usr/bin/env python3
"""Validate a model with an independently built PurismCore shared library.

Original Python validation harness, copyright (c) 2026 AI Live2D Maker contributors.
No official Live2D SDK or Core is downloaded or included.

Reference runtime: SakuraMotion/PurismCore (MIT), commit
1069334965522df5d0b791e97f01e26b19c45456
https://github.com/SakuraMotion/PurismCore
Upstream copyright: (c) 2026 Sakura Motion Project, https://sakura2d.org/.
Its license must accompany any redistribution of that separate runtime. This
harness calls its documented public C API; no upstream C implementation is copied.

This validates structure and sampled runtime geometry, not rendered image quality,
physics, every combined parameter pose, official Cubism Core, or VTube Studio.
Only load a trusted locally built shared library: loading a library executes code.
"""
import argparse
import ctypes as C
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys

MAX_MOC_BYTES = 100 * 1024 * 1024
MAX_MODEL_BYTES = 256 * 1024 * 1024
MAX_PARAMETERS = 1000
MAX_DRAWABLES = 10000
MAX_VERTICES = 4_000_000
MAX_INDICES = 12_000_000
MAX_MOUTH_DRAWABLES = 64
MAX_DIAGNOSTIC_ID_BYTES = 128
MOUTH_DRAWABLE_ID = re.compile(r'ArtMeshMouth(?:Open|Close)(?:_[A-Za-z0-9_]+)?\Z')
SAMPLES = (0, .25, .5, .75, 1)
UPSTREAM_COMMIT = '1069334965522df5d0b791e97f01e26b19c45456'


class ValidationError(Exception):
    pass


def require(ok, message):
    if not ok:
        raise ValidationError(message)


class Vector2(C.Structure):
    _fields_ = [('X', C.c_float), ('Y', C.c_float)]


def aligned(size, alignment):
    buffer = C.create_string_buffer(size + alignment)
    return buffer, (C.addressof(buffer) + alignment - 1) & ~(alignment - 1)


def validate(library_path, model_path):
    require(library_path.is_file(), 'runtime library not found')
    require(model_path.is_file(), 'model file not found')
    require(64 <= model_path.stat().st_size <= MAX_MOC_BYTES,
            'model must be between 64 bytes and 100 MiB')
    with model_path.open('rb') as stream:
        data = stream.read(MAX_MOC_BYTES + 1)
    require(64 <= len(data) <= MAX_MOC_BYTES and data[:4] == b'MOC3',
            'invalid or oversized MOC3 input')
    library = C.CDLL(str(library_path.resolve()))
    pointer, integer, floating = C.c_void_p, C.c_int, C.c_float

    def function(name, arguments, result):
        result_function = getattr(library, name)
        result_function.argtypes = arguments
        result_function.restype = result
        return result_function

    consistency = function('csmHasMocConsistency', [pointer, C.c_uint], integer)
    revive = function('csmReviveMocInPlace', [pointer, C.c_uint], pointer)
    model_size = function('csmGetSizeofModel', [pointer], C.c_uint)
    initialize = function('csmInitializeModelInPlace', [pointer, pointer, C.c_uint], pointer)
    update = function('csmUpdateModel', [pointer], None)
    parameter_count = function('csmGetParameterCount', [pointer], integer)
    drawable_count = function('csmGetDrawableCount', [pointer], integer)
    parameter_ids = function('csmGetParameterIds', [pointer], C.POINTER(C.c_char_p))
    parameter_values = function('csmGetParameterValues', [pointer], C.POINTER(floating))
    parameter_min = function('csmGetParameterMinimumValues', [pointer], C.POINTER(floating))
    parameter_max = function('csmGetParameterMaximumValues', [pointer], C.POINTER(floating))
    parameter_default = function('csmGetParameterDefaultValues', [pointer], C.POINTER(floating))
    vertex_count = function('csmGetDrawableVertexCounts', [pointer], C.POINTER(integer))
    positions = function('csmGetDrawableVertexPositions', [pointer], C.POINTER(C.POINTER(Vector2)))
    uvs = function('csmGetDrawableVertexUvs', [pointer], C.POINTER(C.POINTER(Vector2)))
    index_count = function('csmGetDrawableIndexCounts', [pointer], C.POINTER(integer))
    indices = function('csmGetDrawableIndices', [pointer], C.POINTER(C.POINTER(C.c_ushort)))
    opacity = function('csmGetDrawableOpacities', [pointer], C.POINTER(floating))
    texture_index = function('csmGetDrawableTextureIndices', [pointer], C.POINTER(integer))
    # Optional diagnostics must also work with runtimes/models that lack IDs.
    try:
        drawable_ids = function('csmGetDrawableIds', [pointer], C.POINTER(pointer))
    except AttributeError:
        drawable_ids = None

    # Keep both owner buffers alive until all pointer reads/updates are complete.
    moc_buffer, moc_pointer = aligned(len(data), 64)
    C.memmove(moc_pointer, data, len(data))
    require(consistency(moc_pointer, len(data)) == 1,
            'independent runtime rejected MOC3 consistency')
    moc = revive(moc_pointer, len(data))
    require(bool(moc), 'independent runtime could not revive MOC3')
    size = model_size(moc)
    require(0 < size <= MAX_MODEL_BYTES, 'runtime model allocation exceeds limit')
    model_buffer, model_pointer = aligned(size, 16)
    model = initialize(moc, model_pointer, size)
    require(bool(model), 'independent runtime could not initialize model')
    count, drawables = parameter_count(model), drawable_count(model)
    require(0 <= count <= MAX_PARAMETERS and 0 < drawables <= MAX_DRAWABLES,
            'parameter or drawable count exceeds limit')
    names, values = parameter_ids(model), parameter_values(model)
    minimums, maximums, defaults = parameter_min(model), parameter_max(model), parameter_default(model)
    require(not count or all(bool(p) for p in [names, values, minimums, maximums, defaults]),
            'missing parameter arrays')
    parameters = []
    for i in range(count):
        low, high, default = float(minimums[i]), float(maximums[i]), float(defaults[i])
        require(all(math.isfinite(v) for v in [low, high, default]) and low <= default <= high,
                'invalid parameter range or default')
        require(names[i] is not None and len(names[i]) <= 1024, 'invalid parameter ID')
        parameters.append({'id': names[i].decode('utf-8'), 'min': low, 'max': high, 'default': default})

    vertices, triangle_counts, triangle_indices = vertex_count(model), index_count(model), indices(model)
    textures = texture_index(model)
    require(all(bool(p) for p in [vertices, triangle_counts, triangle_indices, textures]),
            'missing drawable arrays')
    vertex_total = index_total = 0
    for j in range(drawables):
        require(0 < vertices[j] <= MAX_VERTICES and 0 <= triangle_counts[j] <= MAX_INDICES
                and triangle_counts[j] % 3 == 0 and textures[j] >= 0, 'invalid drawable geometry counts')
        vertex_total += vertices[j]
        index_total += triangle_counts[j]
        require(vertex_total <= MAX_VERTICES and index_total <= MAX_INDICES,
                'total geometry exceeds limit')
        require(not triangle_counts[j] or bool(triangle_indices[j]), 'missing triangle indices')
        require(all(triangle_indices[j][k] < vertices[j] for k in range(triangle_counts[j])),
                'triangle index exceeds vertex range')
    # Sampled work is bounded independently from individual array sizes.
    require(vertex_total * max(1, count) * len(SAMPLES) <= 100_000_000,
            'parameter sampling exceeds work limit')

    mouth_samples = None
    mouth_status = 'no_mouth_parameter'
    mouth_parameters = [i for i, item in enumerate(parameters) if item['id'] == 'ParamMouthOpenY']
    mouth_index = mouth_parameters[0] if len(mouth_parameters) == 1 else None
    mouth_drawables = []
    if len(mouth_parameters) > 1:
        mouth_status = 'ambiguous_mouth_parameter'
    elif mouth_index is not None:
        ids = drawable_ids(model) if drawable_ids else None
        mouth_status = 'no_drawable_ids' if not ids else 'no_known_mouth_drawables'
        if ids:
            for j in range(drawables):
                address = ids[j]
                if not address:
                    mouth_status = 'invalid_drawable_ids'
                    break
                # Read at most 129 bytes, stopping at NUL: c_char_p would first
                # create an unbounded Python bytes object before a length check.
                raw = bytearray()
                for offset in range(MAX_DIAGNOSTIC_ID_BYTES + 1):
                    byte = C.c_ubyte.from_address(address + offset).value
                    if byte == 0:
                        break
                    raw.append(byte)
                if len(raw) > MAX_DIAGNOSTIC_ID_BYTES:
                    mouth_status = 'invalid_drawable_ids'
                    break
                try:
                    name = raw.decode('utf-8')
                except UnicodeError:
                    mouth_status = 'invalid_drawable_ids'
                    break
                if MOUTH_DRAWABLE_ID.fullmatch(name):
                    mouth_drawables.append((j, name))
                    if len(mouth_drawables) > MAX_MOUTH_DRAWABLES:
                        mouth_status = 'too_many_mouth_drawables'
                        break
            else:
                if mouth_drawables:
                    mouth_status = 'available'
                    mouth_samples = {
                        'parameter': 'ParamMouthOpenY',
                        'sample_values': [],
                        'drawables': [{'id': name, 'opacity': []} for _, name in mouth_drawables],
                    }

    def pose():
        update(model)
        points, texture_uvs, opacities = positions(model), uvs(model), opacity(model)
        require(all(bool(p) for p in [points, texture_uvs, opacities]), 'missing updated geometry')
        result = []
        for j in range(drawables):
            require(bool(points[j]) and bool(texture_uvs[j]) and math.isfinite(opacities[j]),
                    'invalid updated drawable')
            result.append(float(opacities[j]))
            for k in range(vertices[j]):
                point, uv = points[j][k], texture_uvs[j][k]
                require(all(math.isfinite(v) for v in [point.X, point.Y, uv.X, uv.Y]),
                        'non-finite vertex or texture coordinate')
                result.extend([float(point.X), float(point.Y)])
        return result

    for i in range(count):
        values[i] = defaults[i]
    baseline = pose()
    for i in range(count):
        deltas = []
        for fraction in SAMPLES:
            values[i] = minimums[i] + (maximums[i] - minimums[i]) * fraction
            current = pose()
            deltas.append(max((abs(a-b) for a, b in zip(baseline, current)), default=0))
            if i == mouth_index and mouth_samples is not None:
                opacities = opacity(model)
                samples = [float(opacities[j]) for j, _ in mouth_drawables]
                if not all(math.isfinite(value) and 0 <= value <= 1 for value in samples):
                    mouth_samples = None
                    mouth_status = 'invalid_opacity'
                else:
                    mouth_samples['sample_values'].append(float(values[i]))
                    for item, value in zip(mouth_samples['drawables'], samples):
                        item['opacity'].append(value)
        values[i] = defaults[i]
        parameters[i]['max_output_delta_samples'] = deltas
    return {
        'runtime': 'PurismCore independent MIT runtime; not official Cubism Core or VTube Studio',
        'reference_runtime_url': 'https://github.com/SakuraMotion/PurismCore',
        'reference_runtime_commit': UPSTREAM_COMMIT,
        'model_sha256': hashlib.sha256(data).hexdigest(),
        'consistency': True,
        'drawable_count': drawables,
        'vertex_count': vertex_total,
        'index_count': index_total,
        'texture_indices': sorted(set(textures[i] for i in range(drawables))),
        'sample_fractions': SAMPLES,
        'parameters': parameters,
        'mouth_opacity_samples': mouth_samples,
        'mouth_opacity_diagnostic_status': mouth_status,
        'finite_default_and_all_parameter_extrema': True,
        'finite_default_and_all_parameter_samples': True,
        'official_cubism_core_validated': False,
        'vtube_studio_validated': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', required=True, type=Path)
    parser.add_argument('mocpath', type=Path)
    arguments = parser.parse_args()
    # Native runtimes may log to C stdout. Preserve stdout exclusively for JSON.
    sys.stdout.flush()
    saved_stdout = os.dup(1)
    os.dup2(2, 1)
    try:
        report = validate(arguments.library, arguments.mocpath)
    except (ValidationError, OSError, AttributeError, UnicodeError, ValueError) as error:
        print(f'Runtime validation failed: {error}', file=sys.stderr)
        return 1
    finally:
        try:
            C.CDLL(None).fflush(None)
        except (AttributeError, OSError):
            pass
        os.dup2(saved_stdout, 1)
        os.close(saved_stdout)
    print(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())

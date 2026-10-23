"""Inspect this trial's PNG/TGA legacy containers after an official GUI save.

This is a bounded texture-retention audit, not a runtime or appearance test.
Unlike the unchanged generated-container reader, it permits Creator's TGA and
trailing editor extension. Compare by node name when texture slots reorder.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]


def load(path):
    if not 0 < path.stat().st_size <= 100*1024*1024:
        raise ValueError('Container budget exceeded.')
    blob=path.read_bytes();offset=0
    def take(n):
        nonlocal offset
        if n<0 or offset+n>len(blob):raise ValueError('Truncated container.')
        value=blob[offset:offset+n];offset+=n;return value
    def uint():return struct.unpack('>I',take(4))[0]
    if take(8)!=b'TRNSRTS\0':raise ValueError('Only legacy INP/INX is supported.')
    length=uint()
    if not 0<length<=2*1024*1024:raise ValueError('JSON budget exceeded.')
    model=json.loads(take(length))
    if take(8)!=b'TEX_SECT':raise ValueError('Texture section missing.')
    count=uint()
    if not 0<count<=40:raise ValueError('Texture budget exceeded.')
    decoded=0;textures=[];codecs=[]
    for _ in range(count):
        length=uint();codec=take(1)[0]
        if not 0<length<=8*1024*1024 or codec not in (0,1):raise ValueError('Unsupported texture.')
        with Image.open(io.BytesIO(take(length))) as image:
            if (image.format,codec) not in (('PNG',0),('TGA',1)):raise ValueError('Texture codec mismatch.')
            decoded+=image.width*image.height*4
            if decoded>64*1024*1024:raise ValueError('Decoded texture budget exceeded.')
            textures.append(np.array(image.convert('RGBA')))
        codecs.append(codec)
    # The SDK consumes the legacy puppet/textures; Creator owns its following
    # editor extension. Retain its byte count rather than interpreting it here.
    return model,textures,codecs,len(blob)-offset


def parts(model):
    out={}
    def visit(node):
        if node['type']=='Part':
            if node['name'] in out:raise ValueError('Duplicate part names.')
            out[node['name']]=node
        for child in node.get('children',[]):visit(child)
    visit(model['nodes']);return out


def run(args):
    generated,saved,out=(Path(p).resolve() for p in (args.generated,args.saved,args.output))
    if out.is_relative_to(ROOT) or out.exists():raise ValueError('Use a new report outside Git.')
    a,ta,ca,ea=load(generated);b,tb,cb,eb=load(saved);pa,pb=parts(a),parts(b)
    if set(pa)!=set(pb):raise ValueError('Saved part names differ.')
    results=[]
    for role,node in pa.items():
        expected=ta[node['textures'][0]];actual=tb[pb[role]['textures'][0]]
        identical=bool(np.array_equal(expected,actual))
        if not identical:raise ValueError('Saved texture differs: '+role)
        if len(node['mesh']['verts'])!=len(pb[role]['mesh']['verts']):raise ValueError('Saved mesh size differs: '+role)
        results.append({'part':role,'rgba_identical':True,'size':[expected.shape[1],expected.shape[0]]})
    names=lambda m:sorted(p['name'] for p in m['param'])
    if names(a)!=names(b):raise ValueError('Saved parameters differ.')
    report={'schema':1,'generated_sha256':hashlib.sha256(generated.read_bytes()).hexdigest(),
        'creator_saved_sha256':hashlib.sha256(saved.read_bytes()).hexdigest(),
        'stored_alpha_encoding':'premultiplied-floor-rgb-8bit','textures_identical':True,
        'nodes':results,'parameters':names(b),'generated_codecs':ca,'saved_codecs':cb,
        'generated_editor_extension_bytes':ea,'saved_editor_extension_bytes':eb,
        'runtime_validation_performed_by_this_inspector':False,'appearance_quality_passed':False}
    out.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('generated','saved','output'):parser.add_argument('--'+name,required=True)
    run(parser.parse_args())

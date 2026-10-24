"""One private image -> layered head/neck/body + baseline + diagnostic images.

Re-run in a NEW directory; never changes source artwork or the previous ZIP.
Uses pinned local inference. No manual detections/rigging, network image calls,
automatic downloads, Git writes or automatic official/appearance approval.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from server.inochi_worker import decode_image, save_preparation
from server.character_preparation import prepare_character_parts
from server.head_preparation import extend_head_structure
from server.character_parts import decode_asset


def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def provenance(source):
    packages={}
    for name in ['numpy','pillow','opencv-python-headless','torch','torchvision','sam2','rembg','onnxruntime','scipy']:
        try:packages[name]=importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:packages[name]=None
    weights={}
    for path in ['.models/animeface/lbpcascade_animeface.xml','.models/sam2.1_hiera_tiny.pt',
                 '.models/models/birefnet-general-lite/birefnet-general-lite.onnx']:
        p=ROOT/path
        weights[path]={'sha256':sha(p),'bytes':p.stat().st_size} if p.is_file() else {'missing':True}
    files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
    code=hashlib.sha256()
    for name in sorted(set(files)):
        path=ROOT/name
        if path.suffix in ('.py','.mjs','.js','.json','.toml') and path.is_file():
            code.update(name.encode());code.update(b'\0');code.update(path.read_bytes());code.update(b'\0')
    try:sam_source=json.loads(importlib.metadata.distribution('sam2').read_text('direct_url.json') or '{}')
    except importlib.metadata.PackageNotFoundError:sam_source={}
    return {'input_sha256':sha(source),'input_original_filename_not_recorded':True,
        'source_image_included':False,'python':platform.python_version(),'platform':platform.platform(),
        'packages':packages,'weights':weights,'node':subprocess.check_output(['node','--version'],text=True).strip(),
        'code_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'source_code_sha256':code.hexdigest(),'sam2_source':sam_source,
        'uncommitted_source_changes':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),
        'generator':'scripts/parts/rig.py','blink_profile':'contour-lid-v2','head_profile':'head-neck-body-v1',
        'official_creator_version':'0.8.6','sdk_revision':'dda3a8f005f808104caa43183ab8753fb989e30f'}


def command(*args,timeout=120):
    subprocess.run([str(a) for a in args],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,timeout=timeout)


def generate(args):
    source=Path(args.source).resolve();output=Path(args.output).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new private directory outside Git.')
    os.umask(0o077);output.mkdir(parents=True,mode=0o700);started=time.monotonic()
    proof=provenance(source);(output/'provenance.json').write_text(json.dumps(proof,indent=2))
    with decode_image(source) as image:
        prepared=prepare_character_parts(image,blink_profile='contour-lid-v2')
        extended=extend_head_structure(image,prepared)
    graph,assets=extended['graph'],extended['assets']
    common=output/'common';common.mkdir()
    for path,data in assets.items():
        target=common/path;target.parent.mkdir(exist_ok=True);target.write_bytes(data)
    manifest=common/'parts.json';manifest.write_text(json.dumps(graph,ensure_ascii=False,indent=2),encoding='utf-8')
    Image.fromarray(extended['foreground']).save(output/'neutral-reconstruction.png')
    sheet=Image.new('RGB',(4*300,420),'#bdbdbd');draw=ImageDraw.Draw(sheet)
    for i,role in enumerate(['head_surface','neck','body','hair_strand']):
        canvas=Image.new('RGBA',(graph['source']['width'],graph['source']['height']))
        for p in graph['parts']:
            if p['role']!=role or not p['observed']['rgba']:continue
            im=Image.fromarray(decode_asset(assets,p['observed']['rgba']));canvas.alpha_composite(im,tuple(p['source_box_xywh'][:2]))
        canvas.thumbnail((290,380));sheet.paste(canvas,(i*300+5,30),canvas);draw.text((i*300+5,5),role,fill='black')
    sheet.save(output/'independent-layers.png')
    five=output/'five-part';five.mkdir();save_preparation(prepared['five'],five)
    command('node',ROOT/'scripts/inochi2d/generate.mjs',five/'manifest.json',five/'model')
    baseline=output/'baseline';baseline.mkdir()
    command('node',ROOT/'scripts/inochi2d/parts-adapter.mjs',manifest,baseline/'model')
    target=output/'head';target.mkdir()
    command('node',ROOT/'scripts/inochi2d/head-rig.mjs',manifest,target/'model')
    (target/'preparation-report.json').write_text(json.dumps(prepared['five']['diagnostics'],indent=2))
    report={'format':'ai-live2d-maker-independent-head-trial','version':1,
        'source_sha256':proof['input_sha256'],'head_preparation':extended['head_report'],
        'head_model_sha256':sha(target/'model.inp'),'baseline_model_sha256':sha(baseline/'model.inp'),
        'file_generation_passed':True,'official_creator_passed':False,'appearance_quality_passed':False,
        'automatic_head_diagnostic_passed':None,
        'source_original_file_included':False,'external_image_requests':False,'manual_rigging':False,
        'elapsed_seconds':round(time.monotonic()-started,3)}
    (output/'trial-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    try:
        command(sys.executable,ROOT/'scripts/inochi2d/render-diagnostic.py','--model',target/'model.inp',
                '--common',manifest,'--output',output/'blink-quality')
        command(sys.executable,ROOT/'scripts/inochi2d/render-head.py','--model',target/'model.inp',
                '--baseline',baseline/'model.inp','--common',manifest,'--output',output/'head-quality',timeout=240)
    except Exception as error:
        report.update(automatic_head_diagnostic_passed=False,diagnostic_failure=str(error)[:500],elapsed_seconds=round(time.monotonic()-started,3))
        (output/'trial-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        raise
    report.update(automatic_head_diagnostic_passed=True,elapsed_seconds=round(time.monotonic()-started,3))
    (output/'trial-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True)
    generate(parser.parse_args())

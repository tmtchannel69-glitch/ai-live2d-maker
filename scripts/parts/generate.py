"""Private automatic detailed-part pipeline, with an independent Inochi adapter.

No manual points, boxes, paint masks or rigging are accepted. Generated images
stay outside Git. The normal application/5-part workers are not changed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import cv2
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from server.inochi_worker import decode_image,save_preparation
from server.character_preparation import prepare_character_parts
from server.character_parts import decode_asset,EYE_ROLES
from server.parts_quality import inspect_skin


def contact(prepared,output):
    graph,assets=prepared['graph'],prepared['assets']
    sheet=Image.new('RGB',(9*155,2*165),'#bdbdbd');draw=ImageDraw.Draw(sheet)
    for row,side in enumerate(('l','r')):
        for col,role in enumerate(EYE_ROLES):
            p=next(p for p in graph['parts'] if p['side']==side and p['role']==role)
            x,y=col*155,row*165;draw.text((x+4,y+4),side+' '+role,fill='black')
            if p['observed']['rgba']:
                im=Image.fromarray(decode_asset(assets,p['observed']['rgba']));im.thumbnail((145,130));sheet.paste(im,(x+4,y+26),im)
            else:draw.text((x+4,y+48),p['recognition']['status'],fill='black')
    sheet.save(output/'eye-parts.png')
    generated=[p for p in graph['parts'] if p['completion']['pixels']]
    sheet=Image.new('RGB',(4*370,((len(generated)+3)//4)*235),'#bdbdbd');draw=ImageDraw.Draw(sheet)
    for i,p in enumerate(generated):
        x,y=i%4*370,i//4*235;draw.text((x+5,y+4),p['id'][:45],fill='black')
        w,h=p['source_box_xywh'][2:];observed=Image.new('RGBA',(w,h))
        if p['observed']['rgba']:observed=Image.fromarray(decode_asset(assets,p['observed']['rgba']))
        inferred=Image.fromarray(decode_asset(assets,p['completion']['rgba']))
        combined=Image.alpha_composite(inferred,observed)
        for j,(label,im) in enumerate([('OBSERVED',observed),('WITH ESTIMATE',combined)]):
            im.thumbnail((175,185));sheet.paste(im,(x+5+j*180,y+40),im);draw.text((x+5+j*180,y+23),label,fill='black')
    sheet.save(output/'completion-before-after.png')
    hair=[p for p in graph['parts'] if p['role'] in ('hair_strand','hair_region')]
    if hair:
        sheet=Image.new('RGB',(5*210,((len(hair)+4)//5)*270),'#bdbdbd');draw=ImageDraw.Draw(sheet)
        for i,p in enumerate(hair):
            x,y=i%5*210,i//5*270;draw.text((x+4,y+4),p['id'],fill='black');draw.text((x+4,y+19),'candidate '+p['hair_region'],fill='black')
            im=Image.fromarray(decode_asset(assets,p['observed']['rgba']));im.thumbnail((200,225));sheet.paste(im,(x+4,y+40),im)
        sheet.save(output/'hair-candidates.png')


def generate(args):
    output=Path(args.output).resolve();source=Path(args.source).resolve()
    if output.is_relative_to(ROOT) or output.exists():raise ValueError('Use a new output directory outside Git.')
    output.mkdir(parents=True,mode=0o700);started=time.monotonic()
    with decode_image(source) as image:
        prepared=prepare_character_parts(image,include_hair=not args.eyes_only,blink_profile=args.blink_profile)
    common=output/'common';common.mkdir()
    for path,data in prepared['assets'].items():
        target=common/path;target.parent.mkdir(exist_ok=True);target.write_bytes(data)
    graph=prepared['graph'];(common/'parts.json').write_text(json.dumps(graph,ensure_ascii=False,indent=2),encoding='utf-8')
    Image.fromarray(prepared['foreground']).save(output/'neutral-reconstruction.png')
    contact(prepared,output)
    # Quantify remaining smoothness using nearby observed warm skin, excluding
    # the unknown hidden region and hard mask boundaries.
    skin=next(p for p in graph['parts'] if p['id']=='eye_skin_underpaint')
    estimated=decode_asset(prepared['assets'],skin['completion']['rgba']);generated=estimated[:,:,3]>0
    original=prepared['foreground'];rgb=original[:,:,:3].astype(int)
    reference=(rgb[:,:,0]-rgb[:,:,1]>5)&(rgb[:,:,0]-rgb[:,:,2]>5)&(rgb.mean(axis=2)>175)&~generated
    nearby=cv2.dilate(generated.astype(np.uint8),np.ones((31,31),np.uint8)).astype(bool)&reference
    inner=cv2.erode(generated.astype(np.uint8),np.ones((9,9),np.uint8)).astype(bool)
    clean=cv2.erode(nearby.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool)
    skin_report=inspect_skin(estimated[:,:,:3],original[:,:,:3],inner,clean)
    compatibility=output/'five-part';compatibility.mkdir();save_preparation(prepared['five'],compatibility)
    subprocess.run(['node',str(ROOT/'scripts/inochi2d/generate.mjs'),str(compatibility/'manifest.json'),str(compatibility/'model')],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,timeout=40)
    report={'format':'ai-live2d-maker-detailed-part-trial','version':1,
        'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_original_file_included':False,
        'common_data':prepared['report'],'skin_diagnostics':skin_report,'five_part_export_passed':True,
        'file_generation_passed':False,'official_creator_passed':False,'appearance_quality_passed':False}
    if args.engine=='inochi2d':
        target=output/'inochi2d';target.mkdir()
        subprocess.run(['node',str(ROOT/'scripts/inochi2d/parts-adapter.mjs'),str(common/'parts.json'),str(target/'model')],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,timeout=40)
        (target/'preparation-report.json').write_text(json.dumps(prepared['five']['diagnostics'],indent=2))
        report['file_generation_passed']=True;report['model_sha256']=hashlib.sha256((target/'model.inp').read_bytes()).hexdigest()
        report['runtime_flattening']=json.loads((target/'model.report.json').read_text())['runtimeFlattening']
        quality_started=time.monotonic()
        subprocess.run([sys.executable,str(ROOT/'scripts/inochi2d/render-diagnostic.py'),
            '--model',str(target/'model.inp'),'--common',str(common/'parts.json'),'--output',str(output/'quality')],
            cwd=ROOT,check=True,stdout=subprocess.DEVNULL,timeout=90)
        report['automatic_blink_quality']=json.loads((output/'quality/quality-report.json').read_text())
        report['blink_diagnostic_seconds']=round(time.monotonic()-quality_started,3)
    report['elapsed_seconds']=round(time.monotonic()-started,3)
    (output/'trial-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--engine',choices=['inochi2d','parts-only'],default='inochi2d')
    parser.add_argument('--eyes-only',action='store_true',help='Explicitly skip SAM hair candidates; reports not-requested')
    parser.add_argument('--blink-profile',choices=['contour-lid-v2','detailed-v1'],default='contour-lid-v2',help='Keep detailed-v1 available for exact before/after comparisons.')
    generate(parser.parse_args())

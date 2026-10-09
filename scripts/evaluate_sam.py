"""Synthetic smoke benchmark only. No user data or downloaded evaluation images."""
import io
import json
import time
import platform
import resource
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from server.engine import SamEngine
from server.app import Prompt

engine = SamEngine()
rows = []
started = time.perf_counter()
for sample in range(3):
    image = Image.new('RGB', (256, 384), ['#ededed','#91a4bd','#e2d3b0'][sample])
    draw = ImageDraw.Draw(image)
    bounds = {'body': (55,180,201,355), 'face': (80,70,176,180), 'hair': (68,25,188,82), 'eyes': (95,105,113,120)}
    masks = {}
    for part, color in [('body','#5588bf'),('face','#f4c79b'),('hair','#533249'),('eyes','#161725')]:
        box = bounds[part]
        draw.ellipse(box, fill=color)
        mask = Image.new('L', image.size); ImageDraw.Draw(mask).ellipse(box,fill=255)
        masks[part] = np.asarray(mask) > 0
    # Remove occluding regions from ground-truth visible masks.
    masks['face'] &= ~masks['hair'] & ~masks['eyes']
    prompts = [Prompt(id=part, box=(x1/256,y1/384,x2/256,y2/384)) for part,(x1,y1,x2,y2) in bounds.items()]
    for run in range(3):
        begin = time.perf_counter(); outputs = engine.segment(image, prompts); seconds = time.perf_counter()-begin
        for prompt, mask in zip(prompts,outputs):
            target = masks[prompt.id]
            iou = float((mask & target).sum()/max(1,(mask | target).sum()))
            rows.append({'sample':sample,'part':prompt.id,'run':run,'iou':round(iou,4),'request_seconds':round(seconds,3),'prompt':'box'})
        print(f'sample {sample}, run {run}: {seconds:.3f}s', flush=True)
report={'scope':'3 synthetic scenes, 4 visible shapes each, 3 runs; not real character quality validation',
        'python':platform.python_version(),'device':'CPU, 4 torch threads',
        'model':'sam2.1-hiera-tiny','input_size':[256,384], 'rows':rows,
        'total_seconds':round(time.perf_counter()-started,3),
        'peak_rss_kib_linux':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'median_iou':float(np.median([row['iou'] for row in rows]))}
Path('/tmp/live2d-sam-evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({key:value for key,value in report.items() if key!='rows'},ensure_ascii=False),flush=True)

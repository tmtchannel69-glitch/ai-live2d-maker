"""Background-removal smoke check, using an original synthetic image only."""
import hashlib
import json
import os
from pathlib import Path
import time
os.environ.setdefault('U2NET_HOME', str(Path('.models').resolve()))
os.environ.setdefault('OMP_NUM_THREADS', '4')
import onnxruntime
onnxruntime.disable_telemetry_events()
from rembg import new_session, remove
from PIL import Image, ImageDraw

start = time.perf_counter()
session = new_session('birefnet-general-lite', providers=['CPUExecutionProvider'])
load = time.perf_counter() - start
image = Image.new('RGB', (256,384), 'white')
draw = ImageDraw.Draw(image)
draw.ellipse((70,30,185,170),fill='#f4c79b')
draw.rounded_rectangle((50,150,205,350),20,fill='#5588bf')
times = []
for _ in range(3):
    start = time.perf_counter(); output = remove(image,session=session)
    times.append(round(time.perf_counter()-start,3))
assert output.size == image.size and output.mode == 'RGBA'
assert output.getpixel((0,0))[3] == 0 and output.getpixel((128,240))[3] > 0
report = {'scope':'one synthetic shape scene, not real character quality validation',
          'model':'birefnet-general-lite','device':'CPUExecutionProvider','input_size':[256,384],
          'load_seconds':round(load,3),'run_seconds':times,
          'corner_alpha':output.getpixel((0,0))[3],'center_alpha':output.getpixel((128,240))[3]}
Path('/tmp/live2d-background-evaluation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

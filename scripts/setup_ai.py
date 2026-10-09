"""Prepare the CPU-only local prototype. Run from the repository root."""
import os
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Use Python 3.12 for this tested prototype.')
if sys.platform not in ('linux','win32'):
    raise SystemExit('This CPU setup is tested on Linux; Windows instructions are provided. Other platforms need separate validation.')
if not (ROOT / '.venv').exists(): venv.create(ROOT / '.venv', with_pip=True)
python = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
pip = [str(python), '-m', 'pip', 'install', '--cache-dir', str(ROOT / '.models' / 'pip-cache')]
subprocess.run(pip + ['torch==2.5.1+cpu','torchvision==0.20.1+cpu','--index-url','https://download.pytorch.org/whl/cpu'], check=True)
subprocess.run(pip + ['setuptools==78.1.0','wheel==0.45.1'],check=True)
subprocess.run(pip + ['-r','server/requirements.txt'],check=True)
environment = os.environ.copy(); environment['SAM2_BUILD_CUDA'] = '0'
subprocess.run(pip + ['--no-build-isolation','git+https://github.com/facebookresearch/sam2.git@2b90b9f5ceec907a1c18123530e92e794ad901a4'],env=environment,check=True)
subprocess.run([str(python),'scripts/download_sam.py'],check=True)
print('CPU prototype prepared. Start: python -m uvicorn server.app:app --host 127.0.0.1 --port 8000 using the .venv interpreter.')

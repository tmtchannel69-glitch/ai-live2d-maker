"""Download pinned local Inochi image-preparation weights, never artwork.

Explicit setup only: the HTTP generation endpoint never invokes this script.
Existing files must match their pinned digest and are never overwritten.
"""
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request

from download_animeface import download as download_detector

ROOT = Path(__file__).resolve().parents[1]
BACKGROUND_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx'
BACKGROUND_SHA256 = '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333'
BACKGROUND_BYTES = 224005088


def download_background(destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        with destination.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != BACKGROUND_SHA256:
                raise RuntimeError('Existing background model differs; no file was overwritten.')
        print('Background model digest verified.')
        return
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix='.download', delete=False) as output:
        temporary = Path(output.name)
        try:
            digest, count = hashlib.sha256(), 0
            with urllib.request.urlopen(BACKGROUND_URL, timeout=30) as response:
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > BACKGROUND_BYTES:
                        raise RuntimeError('Background model exceeds its pinned size.')
                    digest.update(chunk)
                    output.write(chunk)
            output.close()
            if count != BACKGROUND_BYTES or digest.hexdigest() != BACKGROUND_SHA256:
                raise RuntimeError('Background model digest/size verification failed.')
            os.link(temporary, destination)
        finally:
            output.close()
            temporary.unlink(missing_ok=True)
    print('Background model downloaded and verified.')


if __name__ == '__main__':
    download_detector(ROOT / '.models/animeface/lbpcascade_animeface.xml')
    download_background(ROOT / '.models/models/birefnet-general-lite/birefnet-general-lite.onnx')

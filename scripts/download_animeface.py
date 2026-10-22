"""Opt-in setup for the MIT anime-face cascade; no images are transmitted.

The upstream XML contains its complete MIT notice. It remains together with the
downloaded, ignored model. This helper rejects different bytes and never
overwrites an existing file. Preparation itself never downloads anything.
"""
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request

UPSTREAM_COMMIT = '4433ab1ae1166ea75acfe99eb0f18709dac329a0'
URL = f'https://raw.githubusercontent.com/nagadomi/lbpcascade_animeface/{UPSTREAM_COMMIT}/lbpcascade_animeface.xml'
SHA256 = '9376d30ac38db6bda2a68b88b3b76bbd7e6aa33af47f7f5c76bc88ca75f1ce30'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(destination=Path('.models/animeface/lbpcascade_animeface.xml')):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if digest(destination) != SHA256:
            raise RuntimeError('Existing detector differs; no file was overwritten.')
        print('Anime-face detector digest verified.'); return
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix='.download', delete=False) as output:
        temporary = Path(output.name)
        try:
            with urllib.request.urlopen(URL, timeout=30) as response:
                data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise RuntimeError('Detector download exceeded the expected bound.')
            output.write(data); output.close()
            if digest(temporary) != SHA256:
                raise RuntimeError('Detector digest verification failed.')
            os.link(temporary, destination)
        finally:
            output.close()
            temporary.unlink(missing_ok=True)
    print('Anime-face detector downloaded and verified (MIT notice inside XML).')


if __name__ == '__main__':
    download()

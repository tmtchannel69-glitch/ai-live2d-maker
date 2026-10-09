"""Download the official SAM 2.1 tiny checkpoint with TLS and a pinned digest."""
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request

URL = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt'
# Recorded after the initial TLS-verified download from Meta's official URL.
SHA256 = '7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69'

def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def download(destination=Path('.models/sam2.1_hiera_tiny.pt')):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if digest(destination) != SHA256:
            raise RuntimeError('Existing checkpoint differs from the expected digest; no file was overwritten.')
        print('Official SAM checkpoint digest verified.'); return
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix='.download', delete=False) as output:
        temporary = Path(output.name)
        try:
            with urllib.request.urlopen(URL, timeout=60) as response:
                while chunk := response.read(1024 * 1024): output.write(chunk)
            output.close()
            if digest(temporary) != SHA256: raise RuntimeError('Checkpoint digest verification failed.')
            # Never replace an existing file, including one created concurrently.
            os.link(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    print('Official SAM checkpoint downloaded and verified.')

if __name__ == '__main__': download()

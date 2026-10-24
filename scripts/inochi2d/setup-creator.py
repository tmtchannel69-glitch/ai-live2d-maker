"""Explicitly fetch the pinned, unmodified official Creator Linux release.

Only public software is downloaded. No artwork/models are read or sent. Use a
new directory outside Git. Linux GUI dependencies remain system prerequisites;
Windows users install the official 0.8.6 Windows release separately.
"""
import argparse
import hashlib
import os
from pathlib import Path,PurePosixPath
import stat
import sys
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[2]
URL='https://github.com/Inochi2D/inochi-creator/releases/download/v0.8.6/inochi-creator-linux.zip'
ARCHIVE_SHA='799b989d5fece71f50eafb480f6efbc95d80b0cb79e907b486b39dd9e4eef86f'
BINARY_SHA='2ae3b449a8bd32c826d851a5663e58f3df451b0cfbbed0aa64121ce1f1eb9bcc'


def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def setup(args):
    if sys.platform!='linux':raise ValueError('This pinned binary is Linux-only; use the official Windows 0.8.6 release on Windows.')
    out=Path(args.output).resolve()
    if out.is_relative_to(ROOT) or out.exists():raise ValueError('Use a new directory outside Git.')
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    archive=Path(args.archive).resolve() if args.archive else out/'creator-0.8.6.zip'
    if not args.archive:
        count=0
        with urllib.request.urlopen(URL,timeout=30) as response,archive.open('xb') as f:
            while chunk:=response.read(1024*1024):
                count+=len(chunk)
                if count>32*1024*1024:raise ValueError('Creator archive exceeds pinned download budget.')
                f.write(chunk)
    if digest(archive)!=ARCHIVE_SHA:raise ValueError('Creator release archive digest differs; not extracted.')
    with zipfile.ZipFile(archive) as z:
        total=0
        for entry in z.infolist():
            p=PurePosixPath(entry.filename);total+=entry.file_size
            if p.is_absolute() or '..' in p.parts or '\\' in entry.filename or stat.S_ISLNK(entry.external_attr>>16):
                raise ValueError('Unsafe Creator archive entry.')
            if total>128*1024*1024:raise ValueError('Creator expansion budget exceeded.')
        z.extractall(out/'release')
    binaries=list((out/'release').rglob('inochi-creator'))
    if len(binaries)!=1 or digest(binaries[0])!=BINARY_SHA:raise ValueError('Official Creator binary digest differs.')
    binaries[0].chmod(0o700)
    print(str(binaries[0]))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True)
    p.add_argument('--archive',help='Optional already-downloaded official archive; still verified and never modified')
    setup(p.parse_args())

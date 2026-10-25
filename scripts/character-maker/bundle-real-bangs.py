"""Package private app comparisons with evidence for one specific official model.
Does not upload anything or change the app's generic unverified-runtime flags.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from zipfile import ZipFile,ZipInfo,ZIP_STORED
ROOT=Path(__file__).resolve().parents[2]
def bundle(a):
    folder=Path(a.input).resolve();official=Path(a.official).resolve();fit=Path(a.fit).resolve();audit=Path(a.audit).resolve();out=Path(a.output).resolve()
    if out.is_relative_to(ROOT) or out.exists() or not out.parent.is_dir():raise ValueError('Use a new private ZIP outside Git with an existing parent.')
    app=json.loads((folder/'app-verification.json').read_text());summary=json.loads((official/'official-summary.json').read_text());cases=summary['variants']
    if len(cases)!=1 or cases[0]['generated_sha256']!=app['model_sha256'] or not cases[0]['official_creator_motion_save_reload_passed']:raise ValueError('Official evidence belongs to a different or unverified model.')
    model_sha=hashlib.sha256((folder/'attached/character.inp').read_bytes()).hexdigest()
    if model_sha!=app['model_sha256']:raise ValueError('Current model differs from its verified hash.')
    capture=json.loads((fit/'capture.json').read_text());check=json.loads(audit.read_text())
    if capture['opened_model_sha256']!=cases[0]['saved_sha256'] or check['source_sha256']!=app['source_sha256'] or check['model_sha256']!=model_sha:raise ValueError('Capture or source audit belongs to another model.')
    names={};total=0
    with ZipFile(folder/'bangs-comparison.zip') as source:
        for entry in source.infolist():
            if not re.fullmatch(r'(?:motion/)?[A-Za-z0-9_-]+\.(?:png|json|txt)',entry.filename) or entry.filename in names or entry.file_size>16*1024*1024:raise ValueError('Unexpected comparison entry.')
            names[entry.filename]=source.read(entry);total+=len(names[entry.filename])
    extra={'official/initial_fit.png':(fit/'official-initial-fit.png').read_bytes(),'official/motions.png':(official/'attached/before/official-motion-comparison.png').read_bytes(),
      'official/runtime_summary.json':json.dumps(summary,indent=2).encode(),'official/structure.json':(official/'attached/structure.json').read_bytes(),'official/textures.json':(official/'attached/textures.json').read_bytes(),
      'checks/app.json':(folder/'app-verification.json').read_bytes(),'checks/source_and_attachment.json':audit.read_bytes(),
      'READ_FIRST.txt':('実画像の前髪：検証付きプレビュー\n\nside_by_side.pngとmotion/で交換前後、official/initial_fit.pngで公式Creatorの全体表示を確認できます。\n公式の後検証はmodel SHA256 '+model_sha+' だけに対応します。28状態→保存→新プロセス28状態でviewport差0。\nアプリのimport_report内のofficial flagは汎用exportが公式検証を実行しないことを示し、falseのままです。このofficial/が特定出力への別の検証記録です。\n見た目の品質は未合格。前髪の光沢/線と既存の顔・後ろ髪の画風/形が一致しません。regeneration_request.txtは未送信の修正指示です。\n元PNG/処理後/配置PNGを別々に保持。モデルと制作再開は別のattached/project.zipを保管してください。\nこれはクラウド内で作った実ZIPです。iPhoneへの回答添付/認証共有URLを発行したものではありません。外部サービスやGitHubへ画像/モデルをアップロードしていません。\n').encode('utf8')}
    names.update(extra);total=sum(len(v) for v in names.values())
    if total>16*1024*1024:raise ValueError('Verified preview exceeds the 16 MiB bound.')
    fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as stream:
        with ZipFile(stream,'w',compression=ZIP_STORED) as dest:
            for name,data in names.items():
                info=ZipInfo(name,date_time=(2000,1,1,0,0,0));info.create_system=0;dest.writestr(info,data)
    with ZipFile(out) as verify:
        if verify.testzip():raise ValueError('ZIP integrity failed.')
    print(json.dumps({'output':str(out),'entries':len(names),'bytes':out.stat().st_size,'expanded_bytes':total,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'model_sha256':model_sha,'appearance_quality_passed':False}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['input','official','fit','audit','output']:p.add_argument('--'+key,required=True)
    bundle(p.parse_args())

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildExternalPartComparison} from '../../shared/external-part-comparison.js';
const hash='a'.repeat(64);
const manifest={parts:[{role:'iris_l',label:'左の虹彩'},...Array.from({length:32},(_,i)=>({role:'test_'+i,label:'テスト'+i}))]};
const diagnostics={format:'ai-live2d-external-part-pixel-diagnostics',version:1,rect_size:[62,74],visible_ratio:.125,
 edge_coverage_ratio:.15,visible_bounds:{x:12,y:5,width:15,height:20},warning_codes:['very-low-coverage'],appearance_quality_verified:false};
const report={format:'ai-live2d-external-part-batch-experiment',provided_roles:['iris_l'],
 parts:[{role:'iris_l',source_filename:'iris_l.png',source_sha256:hash,rgba_structure_passed:true,pixel_diagnostics:diagnostics}]};

test('reads a matching imported role without classifying visual quality',()=>{
  const result=buildExternalPartComparison(manifest,report,'iris_l');
  assert.equal(result.role,'iris_l');
  assert.equal(result.visible_percent,12.5);
  assert.equal(result.edge_contact_percent,15);
  assert.deepEqual(result.visible_bounds,{x:12,y:5,width:15,height:20});
  assert.equal(result.warning_count,1);
  assert.equal(result.warnings[0].label,'描画範囲が極端に小さい');
  assert.equal(result.appearance_quality_verified,false);
  assert.equal(result.ai_origin_verified,false);
});
test('rejects missing, template-only and incomplete review roles',()=>{
  assert.throws(()=>buildExternalPartComparison(null,report,'iris_l'));
  assert.throws(()=>buildExternalPartComparison(manifest,report,'test_0'),/差し替え/);
  assert.throws(()=>buildExternalPartComparison(manifest,{...report,parts:[]},'iris_l'),/不足/);
});
test('read-only mapping does not mutate original diagnostic data',()=>{
  const result=buildExternalPartComparison(manifest,report,'iris_l');
  result.visible_bounds.width=0;
  result.warnings[0].label='改変';
  assert.equal(diagnostics.visible_bounds.width,15);
  assert.deepEqual(diagnostics.warning_codes,['very-low-coverage']);
  assert.equal(manifest.parts[0].label,'左の虹彩');
});

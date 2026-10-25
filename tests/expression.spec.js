import {test,expect} from '@playwright/test';
import {unzipSync,strFromU8} from 'fflate';

async function setup(page) {
  await page.goto('/?mode=convert');const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=128;c.height=192;c.getContext('2d').fillRect(0,0,128,192);return c.toDataURL().split(',')[1];});
  await page.locator('#file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.locator('#source-preview')).toBeVisible();return png;
}
async function download(page,selector) {
  const pending=page.waitForEvent('download');await page.locator(selector).click();const d=await pending,chunks=[];for await(const c of await d.createReadStream())chunks.push(c);return {name:d.suggestedFilename(),bytes:Buffer.concat(chunks)};
}
async function prompts(page,ids) {
  await page.locator('#edit-prompts').click();if(!await page.locator('#coordinate-form').isVisible())await page.getByText('数値で指定（キーボード操作）').click();
  for(const id of ids){await page.locator('#prompt-part').selectOption(id);await page.locator('#coordinate-form input[name=x]').fill('50');await page.locator('#coordinate-form input[name=y]').fill('50');await page.getByRole('button',{name:'数値を反映'}).click();}await page.locator('#close-prompts').click();
}

test('expression preparation selects recommended parts without losing either workspace or sending images',async({page})=>{
  let requests=0;page.on('request',r=>{if(r.url().includes('/api/separate'))requests++;});await setup(page);await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(4);const basicUrl=await page.locator('[data-part=hair] img').getAttribute('src');
  await page.locator('#parts-template').selectOption('production');await page.locator('.part-options input[value=top]').check();await page.locator('#parts-template').selectOption('basic');
  await page.locator('[data-prepare=blink]').click();await expect(page.locator('#parts-template')).toHaveValue('production');await expect(page.locator('.part-options input:checked')).toHaveCount(6);await expect(page.locator('.part-options input[value=top]')).toBeChecked();await expect(page.locator('#processing-mode')).toHaveValue('ai');await expect(page.locator('#separate')).toBeDisabled();await expect(page.locator('#edit-prompts')).toBeFocused();
  await page.locator('[data-prepare=mouth]').click();await expect(page.locator('.part-options input:checked')).toHaveCount(7);const selected=await page.locator('.part-options input:checked').evaluateAll(inputs=>inputs.map(i=>i.value));expect(selected).toEqual(expect.arrayContaining(['eye_l','eye_r','face_skin','brow_l','brow_r','mouth_visible','top']));
  await page.locator('#parts-template').selectOption('basic');await expect(page.locator('.result-card')).toHaveCount(4);expect(await page.locator('[data-part=hair] img').getAttribute('src')).toBe(basicUrl);expect(requests).toBe(0);
  const report=await download(page,'#expression-report');expect(report.name).toBe('ai-live2d-expression-preparation.txt');expect(report.bytes.subarray(0,3)).toEqual(Buffer.from([239,187,191]));const text=report.bytes.toString();expect(text).toContain('未分離');expect(text).toContain('ParamEyeLOpen');expect(text).toContain('口の内部');expect(text).toContain('この画面では未確認');expect(text).not.toContain('data:image');expect(text).not.toContain('synthetic.png');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#reset').click();await expect(page.locator('.expression-panel')).toBeHidden();await page.locator('#file').setInputFiles({name:'next.png',mimeType:'image/png',buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;return c.toDataURL().split(',')[1];}),'base64')});await expect(page.locator('#expression-status')).toBeEmpty();
});

test('expression inventory follows actual results, stale prompts and reviews across project restore',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const png=await setup(page);await page.locator('[data-prepare=mouth]').click();await prompts(page,['face_skin','mouth_visible']);
  await page.route('**/api/separate',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({parts:['face_skin','mouth_visible'].map(id=>({id,png}))})}));await page.locator('#separate').click();await expect(page.locator('.result-card')).toHaveCount(2);
  const row=page.locator('[data-expression=mouth] [data-expression-part=mouth_visible]');await expect(row).toHaveAttribute('data-state','unchecked');
  await page.locator('[data-review=mouth_visible] button').click();await page.locator('#review-boundary').selectOption('checked');await page.locator('#review-fill').selectOption('needed');await page.locator('#review-note').fill('<script>口の裏側を準備</script>');await page.locator('#close-review').click();await expect(row).toHaveAttribute('data-state','checked');await expect(row).toContainText('描き足しが必要');
  // Unselected results still belong to the production inventory.
  await page.locator('.part-options input[value=mouth_visible]').uncheck();await expect(row).toHaveAttribute('data-state','checked');
  await page.getByRole('button',{name:'口の見える部分を修正',exact:true}).click();if(!await page.locator('#coordinate-form').isVisible())await page.getByText('数値で指定（キーボード操作）').click();await page.locator('#coordinate-form input[name=x]').fill('60');await page.getByRole('button',{name:'数値を反映'}).click();await page.locator('#close-prompts').click();await expect(row).toHaveAttribute('data-state','stale');
  const before=(await download(page,'#expression-report')).bytes;expect(before.toString()).toContain('指定変更あり・再分離が必要');expect(before.toString()).toContain('<script>口の裏側を準備</script>');
  const work=(await download(page,'#save-project')).bytes;expect(JSON.parse(strFromU8(unzipSync(work)['project.json'])).version).toBe(3);
  await page.reload();await page.locator('#project-file').setInputFiles({name:'work.zip',mimeType:'application/zip',buffer:work});await expect(page.locator('#project-status')).toContainText('作業を再開');await expect(row).toHaveAttribute('data-state','stale');expect((await download(page,'#expression-report')).bytes).toEqual(before);
  // Preparation is disabled during in-flight separation, and no partial model is claimed.
  await page.locator('.part-options input[value=mouth_visible]').check();await page.route('**/api/separate',async r=>{await new Promise(resolve=>setTimeout(resolve,250));await r.fulfill({contentType:'application/json',body:JSON.stringify({parts:['face_skin','mouth_visible'].map(id=>({id,png}))})});});await page.locator('#separate').click();await expect(page.locator('[data-prepare=blink]')).toBeDisabled();await expect(page.locator('#expression-report')).toBeDisabled();await expect(page.locator('#separate')).toBeEnabled();await expect(row).toHaveAttribute('data-state','unchecked');
  expect(errors).toEqual([]);
});

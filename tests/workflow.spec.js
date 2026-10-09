import { test, expect } from '@playwright/test';
async function upload(page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 500;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b89aff'; ctx.fillRect(0, 0, 300, 500);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#file').setInputFiles({ name: 'character.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
}
test('mobile upload, selected parts, PNG download and reset', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /パーツを分離/ })).toBeDisabled();
  await upload(page);
  await expect(page.locator('#source-preview')).toBeVisible();
  await expect(page.locator('#file-info')).toContainText('300 × 500');
  await page.locator('input[value="eyes"]').uncheck();
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
  await expect(page.locator('#status')).toContainText('3 個');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '髪をダウンロード' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('hair.png');
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBe(300); expect(bytes.readUInt32BE(20)).toBe(175);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ai-live2d-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'リセット' }).click();
  await expect(page.locator('#source-preview')).toBeHidden();
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /パーツを分離/ })).toBeDisabled();
  expect(errors).toEqual([]);
});
test('invalid files and empty selection cannot run', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await expect(page.locator('#status')).toContainText('読み込めません');
  await page.locator('#file').setInputFiles({ name: 'document.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.locator('#status')).toContainText('10 MB 以下');
  await upload(page);
  for (const checkbox of await page.locator('.part-options input').all()) await checkbox.uncheck();
  await expect(page.getByRole('button', { name: /パーツを分離/ })).toBeDisabled();
});
test('desktop layout displays four downloadable parts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/'); await upload(page);
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.result-card')).toHaveCount(4);
  await expect(page.locator('.result-card img').first()).toBeVisible();
  expect(await page.locator('.result-card img').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
});

test('ZIP contents, progress, enlarged preview and keyboard close', async ({ page }) => {
  const { unzipSync } = await import('fflate');
  await page.goto('/');
  await expect(page.locator('.steps [aria-current="step"]')).toContainText('画像を選択');
  await upload(page);
  await expect(page.locator('.steps [aria-current="step"]')).toContainText('パーツを分離');
  await page.locator('input[value="eyes"]').uncheck();
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
  await expect(page.locator('.steps [aria-current="step"]')).toContainText('ダウンロード');
  await page.getByRole('button', { name: '髪を拡大表示' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#dialog-image')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '髪を拡大表示' })).toBeFocused();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'まとめて ZIP 保存' }).click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe('character-parts.zip');
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const files = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(files).sort()).toEqual(['body.png', 'face.png', 'hair.png']);
  for (const bytes of Object.values(files)) expect(Buffer.from(bytes).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await page.getByRole('button', { name: '髪を拡大表示' }).click();
  await page.getByRole('button', { name: '閉じる' }).click();
  await upload(page);
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'まとめて ZIP 保存' })).toBeDisabled();
});

test('oversized image is rejected and previous results are retained', async ({ page }) => {
  await page.goto('/'); await upload(page);
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.result-card')).toHaveCount(4);
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 4097; canvas.height = 1;
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#file').setInputFiles({ name: 'too-wide.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('#status')).toContainText('大きすぎます');
  await expect(page.locator('#file-info')).toContainText('character.png');
  await expect(page.locator('.result-card')).toHaveCount(4);
});

test('separation failure can be retried and ZIP failure keeps PNG links', async ({ page }) => {
  await page.goto('/'); await upload(page);
  await page.evaluate(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
  });
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('#status')).toContainText('分離に失敗');
  await expect(page.getByRole('button', { name: /パーツを分離/ })).toBeEnabled();
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.result-card')).toHaveCount(4);
  await page.evaluate(() => {
    window.originalArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async () => { throw new Error('simulated read failure'); };
  });
  await page.getByRole('button', { name: 'まとめて ZIP 保存' }).click();
  await expect(page.locator('#status')).toContainText('ZIP の作成に失敗');
  await expect(page.getByRole('link', { name: '髪をダウンロード' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'まとめて ZIP 保存' })).toBeEnabled();
});

test('reset cancels in-flight separation without stale results', async ({ page }) => {
  await page.goto('/'); await upload(page);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) { const canvas = this; setTimeout(() => original.apply(canvas, args), 200); };
  });
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.settings')).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'リセット' }).click();
  await expect(page.locator('.settings')).toHaveAttribute('aria-busy', 'false');
  await page.waitForTimeout(500);
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('まずは');
  await expect(page.getByRole('button', { name: 'まとめて ZIP 保存' })).toBeDisabled();
});

test('AI prompt editor supports taps, boxes and numeric entry; missing model is explained', async ({ page }) => {
  await page.goto('/'); await upload(page);
  await page.locator('#processing-mode').selectOption('ai');
  for (const id of ['face','body','eyes']) await page.locator(`input[value="${id}"]`).uncheck();
  await expect(page.getByRole('button', { name: /AI でパーツを分離/ })).toBeDisabled();
  await page.getByRole('button', { name: '切り抜く場所を指定' }).click();
  const svg = page.locator('#prompt-dialog svg');
  await svg.click({ position: { x: 50, y: 50 } });
  await expect(page.locator('#prompt-summary')).toContainText('髪');
  await expect(svg.locator('circle')).toHaveCount(1);
  await page.locator('#prompt-kind').selectOption('box');
  const bounds = await svg.boundingBox();
  await page.mouse.move(bounds.x+20,bounds.y+20); await page.mouse.down();
  await page.mouse.move(bounds.x+100,bounds.y+100); await page.mouse.up();
  await expect(svg.locator('rect')).toHaveCount(1);
  await page.getByRole('button', { name: 'この指定を消す' }).click();
  await expect(page.locator('#prompt-summary')).toContainText('なし');
  await page.getByText('数値で指定（キーボード操作）').click();
  await page.locator('#prompt-kind').selectOption('point');
  await page.locator('input[name="x"]').fill('25'); await page.locator('input[name="y"]').fill('30');
  await page.getByRole('button', { name: '数値を反映' }).click();
  await page.locator('#close-prompts').click();
  await expect(page.getByRole('button', { name: /AI でパーツを分離/ })).toBeEnabled();
  await page.route('**/api/separate', async route => {
    const body = route.request().postData(); expect(body).toContain('"point":[0.25,0.3]');
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'SAM のモデルが未配置です。' }) });
  });
  await page.getByRole('button', { name: /AI でパーツを分離/ }).click();
  await expect(page.locator('#status')).toContainText('モデルが未配置');
  await expect(page.locator('.result-card')).toHaveCount(0);
  await page.locator('#processing-mode').selectOption('demo');
  await page.getByRole('button', { name: /パーツを分離/ }).click();
  await expect(page.locator('.result-card')).toHaveCount(1);
});

import {test,expect} from '@playwright/test';
import {reviewFixture} from '../scripts/inochi2d/review-fixture.mjs';
test.use({hasTouch:true,isMobile:true});

async function open(page,buffer=reviewFixture().zip()){
  await page.locator('#inochi-model-open-file').setInputFiles({name:'saved-model.zip',mimeType:'application/zip',buffer});
}
async function displayed(page){await expect(page.locator('#inochi-model-status')).toContainText('モデルZIPを開きました');await expect(page.locator('#inochi-review-image')).toBeVisible();}

test('locally reopens model review without a source image, API requests, or changes to existing work',async({page})=>{
  let apiCalls=0;await page.route('**/api/**',route=>{apiCalls++;return route.abort();});
  await page.goto('/');await open(page);await displayed(page);expect(apiCalls).toBe(0);
  await expect(page.locator('#inochi-review-caption')).toHaveText('通常');await expect(page.locator('#inochi-review-position')).toHaveText('1 / 10');
  await expect(page.locator('#inochi-review-content')).toContainText('公式Creatorの画面や');
  await expect(page.locator('.inochi-review-verdict')).toContainText('未合格');
  await page.locator('#inochi-review-next').tap();await expect(page.locator('#inochi-review-position')).toHaveText('2 / 10');
  await page.locator('#inochi-review-view').selectOption('blink');
  await page.locator('#inochi-review-next').tap();await expect(page.locator('#inochi-review-caption')).toContainText('両目の開度 0.111');
  await page.locator('#inochi-review-play').tap();await expect(page.locator('#inochi-review-play')).toHaveAttribute('aria-pressed','true');
  await page.locator('#inochi-review-play').tap();await expect(page.locator('#inochi-review-play')).toHaveAttribute('aria-pressed','false');
  await page.locator('#inochi-review-parts summary').tap();await expect(page.locator('#inochi-review-part-image')).toBeVisible();
  await expect(page.locator('#inochi-review-part-info')).toContainText('元画像の位置: (0, 0)・2×2px');
  await page.locator('#inochi-review-plane').selectOption('completion');await expect(page.locator('#inochi-review-part-status')).toContainText('補完画像を作っていません');await expect(page.locator('#inochi-review-part-image')).toBeHidden();
  await expect(page.locator('#inochi-model-start')).toBeDisabled();expect(apiCalls).toBe(0);
  const downloaded=page.waitForEvent('download');await page.locator('#inochi-model-download').tap();expect((await downloaded).suggestedFilename()).toBe('inochi2d-head-neck-body.zip');
});

test('invalid imported ZIP preserves the previous model, images, and editing source',async({page})=>{
  await page.goto('/');
  const bytes=reviewFixture().files['common/observed/head_surface.png'];
  await page.locator('#file').setInputFiles({name:'existing.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await open(page);await displayed(page);
  const previous=await page.locator('#inochi-review-image').getAttribute('src');
  const broken=reviewFixture();delete broken.files['review/head-01.png'];
  await open(page,broken.zip());await expect(page.locator('#inochi-model-status')).toContainText('前回のモデルは保持');
  await expect(page.locator('#inochi-review-image')).toHaveAttribute('src',previous);await expect(page.locator('#inochi-model-download')).toBeEnabled();
  await expect(page.locator('#file-info')).toContainText('existing.png');
  await open(page,Buffer.from('not a ZIP'));await expect(page.locator('#inochi-model-status')).toContainText('前回のモデルは保持');
  await expect(page.locator('#inochi-review-image')).toHaveAttribute('src',previous);
});

test('preview URLs are released when changing frames or selecting a new image',async({page})=>{
  await page.addInitScript(()=>{
    window.reviewRevoked=[];const original=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=url=>{window.reviewRevoked.push(url);original(url);};
  });
  await page.goto('/');await open(page);await displayed(page);
  const first=await page.locator('#inochi-review-image').getAttribute('src');
  await page.locator('#inochi-review-next').click();expect(await page.evaluate(url=>reviewRevoked.includes(url),first)).toBe(true);
  const second=await page.locator('#inochi-review-image').getAttribute('src');
  await page.locator('#inochi-review-play').click();
  await page.locator('#file').setInputFiles({name:'another.png',mimeType:'image/png',buffer:Buffer.from(reviewFixture().files['common/observed/head_surface.png'])});
  await expect(page.locator('#inochi-model-result')).toBeHidden();expect(await page.evaluate(url=>reviewRevoked.includes(url),second)).toBe(true);
  await expect(page.locator('#inochi-review-play')).toHaveAttribute('aria-pressed','false');
});

test('review stays inside phone widths with touch-sized controls',async({page})=>{
  await page.goto('/');await open(page);await displayed(page);await page.locator('#inochi-review-parts summary').click();
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const id of ['#inochi-model-open','#inochi-review-view','#inochi-review-frame','#inochi-review-prev','#inochi-review-next','#inochi-review-play','#inochi-review-part','#inochi-review-plane']){
      expect(await page.locator(id).evaluate(e=>e.getBoundingClientRect().height),id).toBeGreaterThanOrEqual(48);
    }
    for(const id of ['#inochi-review-view','#inochi-review-part','#inochi-review-plane'])expect(await page.locator(id).evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  }
});

test('the upload shortcut reaches automatic generation without any image request or manual prompts',async({page})=>{
  let requests=0;await page.route('**/api/**',route=>{requests++;return route.abort();});
  await page.goto('/');await expect(page.locator('#inochi-model-jump')).toBeDisabled();
  await page.locator('#file').setInputFiles({name:'character.png',mimeType:'image/png',buffer:Buffer.from(reviewFixture().files['common/observed/head_surface.png'])});
  await page.locator('#inochi-model-jump').tap();await expect(page.locator('#inochi-model-title')).toBeFocused();
  await expect(page.locator('#inochi-model-title')).toBeInViewport();expect(requests).toBe(0);
  await expect(page.locator('#inochi-model-start')).toBeEnabled();
  expect(await page.locator('#inochi-model-jump').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
});

test('cancelling an archive read cannot replace the previous result after a late completion',async({page})=>{
  await page.addInitScript(()=>{
    const read=Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer=async function(){if(this.name==='slow-model.zip')await new Promise(resolve=>{window.finishSlowReview=resolve;});return read.call(this);};
  });
  await page.goto('/');await open(page);await displayed(page);
  const previous=await page.locator('#inochi-review-image').getAttribute('src');
  await page.locator('#inochi-model-open-file').setInputFiles({name:'slow-model.zip',mimeType:'application/zip',buffer:reviewFixture().zip()});
  await expect(page.locator('#inochi-model-status')).toContainText('端末内で読み込んでいます');
  await page.locator('#inochi-model-cancel').click();await page.evaluate(()=>finishSlowReview());
  await expect(page.locator('#inochi-model-status')).toContainText('読み込みを中止');
  await expect(page.locator('#inochi-review-image')).toHaveAttribute('src',previous);await expect(page.locator('#inochi-model-download')).toBeEnabled();
});

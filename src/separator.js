import { separateWithApi } from './api-separator.js';
/** Replace this adapter with an API implementation returning { id, name, blob }[].
 * Input: { file: File, parts: string[], signal: AbortSignal }.
 * Production adapters should return transparent PNGs and respect cancellation.
 */
export async function separateParts({ file, parts, signal, mode = 'demo', prompts = {}, onProgress }) {
  if (mode === 'ai') return separateWithApi({ file, parts, signal, prompts, onProgress });
  const bitmap = await createImageBitmap(file);
  try {
    // Deliberately a demo: rectangular crops, not AI segmentation.
    const regions = {
      hair: [0, 0, 1, .35], face: [.2, .15, .6, .35],
      body: [.15, .45, .7, .55], eyes: [.2, .25, .6, .12],
    };
    const results = [];
    for (const id of parts) {
      signal?.throwIfAborted();
      const [x, y, w, h] = regions[id];
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * w));
      canvas.height = Math.max(1, Math.round(bitmap.height * h));
      canvas.getContext('2d').drawImage(bitmap, bitmap.width * x, bitmap.height * y,
        bitmap.width * w, bitmap.height * h, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('画像の生成に失敗しました。')), 'image/png'));
      results.push({ id, name: `${id}.png`, blob });
    }
    signal?.throwIfAborted();
    return results;
  } finally { bitmap.close(); }
}

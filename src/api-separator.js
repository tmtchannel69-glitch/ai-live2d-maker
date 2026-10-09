async function requestBatch({ file, parts, prompts, signal }) {
  const data = new FormData(); data.append('image', file);
  data.append('prompts', JSON.stringify(parts.map(id => ({ id, ...prompts[id] }))));
  const response = await fetch('/api/separate', { method: 'POST', body: data, signal });
  let result;
  try { result = await response.json(); } catch { throw new Error('試作サーバーに接続できません。サーバーの起動を確認してください。'); }
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'AI 処理に失敗しました。');
  if (!Array.isArray(result.parts) || result.parts.length !== parts.length || new Set(result.parts.map(part => part.id)).size !== parts.length) {
    throw new Error('AI の結果が正しくありません。');
  }
  return result.parts.map(part => {
    if (!parts.includes(part.id) || typeof part.png !== 'string') throw new Error('AI の結果が正しくありません。');
    const bytes = Uint8Array.from(atob(part.png), char => char.charCodeAt(0));
    return { id: part.id, name: `${part.id}.png`, blob: new Blob([bytes], { type: 'image/png' }) };
  });
}

// Keep the existing server's four-mask limit for bounded inference memory.
export async function separateWithApi({file,parts,prompts,signal,onProgress}) {
  const results=[];
  for(let offset=0;offset<parts.length;offset+=4) {
    signal?.throwIfAborted();
    results.push(...await requestBatch({file,parts:parts.slice(offset,offset+4),prompts,signal}));
    onProgress?.(results.length,parts.length);
  }
  signal?.throwIfAborted();return results;
}

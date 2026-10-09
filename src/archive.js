import { zip } from 'fflate';

export async function createPartsArchive(parts) {
  const entries = Object.fromEntries(await Promise.all(parts.map(async part =>
    [part.name, new Uint8Array(await part.blob.arrayBuffer())])));
  // PNG is already compressed; store it without expensive recompression.
  return new Promise((resolve, reject) => zip(entries, { level: 0 }, (error, data) =>
    error ? reject(error) : resolve(new Blob([data], { type: 'application/zip' }))));
}

export async function downloadWithProgress(
  url: string,
  onProgress?: (p: {
    loaded: number;
    total: number | null;
    ratio: number | null;
  }) => void,
) {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);

  const totalStr = res.headers.get("content-length");
  const total = totalStr ? Number(totalStr) : null;

  // Si no hay streaming (algunos navegadores), fallback simple
  if (!res.body) {
    const blob = await res.blob();
    onProgress?.({ loaded: blob.size, total: total ?? blob.size, ratio: 1 });
    return blob;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;

      const ratio = total ? loaded / total : null;
      onProgress?.({ loaded, total, ratio });
    }
  }

  // Copy chunks into a fresh Uint8Array so Blob receives ArrayBuffer-backed data.
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const blob = new Blob([merged.buffer]);
  onProgress?.({ loaded, total: total ?? loaded, ratio: 1 });

  return blob;
}

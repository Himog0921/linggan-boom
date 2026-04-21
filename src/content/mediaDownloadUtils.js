export function sanitizePathSegment(value, fallback = 'unknown') {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return normalized || fallback;
}

export function detectFileExt(url, fallback = 'jpg') {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const ext = clean.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return (ext || fallback).toLowerCase();
}

export function normalizeCandidateUrl(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `${window.location.protocol}${value}`;
  if (value.startsWith('/')) return `${window.location.origin}${value}`;
  return value;
}

export function candidatePriority(url = '') {
  const value = String(url || '');
  if (/^https?:\/\//i.test(value)) return 0;
  if (value.startsWith('blob:')) return 9;
  return 4;
}

export function normalizeCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const dedup = [];
  for (const raw of list) {
    if (!raw) continue;
    const item = normalizeCandidateUrl(raw);
    if (!item || dedup.includes(item)) continue;
    dedup.push(item);
  }
  return dedup.sort((a, b) => candidatePriority(a) - candidatePriority(b));
}

export function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  const cleanupTimer = setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  cleanupTimer?.unref?.();
}

export function basenameFromPath(path = '') {
  const raw = String(path || '').trim();
  if (!raw) return `媒体_${Date.now()}.mp4`;
  const parts = raw.split('/');
  const name = parts[parts.length - 1] || `媒体_${Date.now()}.mp4`;
  return name.replace(/[\\:*?"<>|]/g, '_');
}

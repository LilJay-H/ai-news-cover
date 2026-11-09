// AIHOT 请求：带 If-None-Match，304 不重绘；成功的响应存本地，断网时可读。
import { store } from './storage.js';

const BASE = 'https://aihot.news/api/v1';
const TIMEOUT_MS = 15000;

// 详情类请求（事件、某一天日报）：只放内存，最多 30 条，1 小时内不重复请求。
const detail = new Map();
const DETAIL_TTL = 60 * 60 * 1000;
const DETAIL_MAX = 30;

export async function getDetail(path) {
  const hit = detail.get(path);
  if (hit && Date.now() - hit.at < DETAIL_TTL) return hit.body;
  const res = await fetch(BASE + path, { headers: { Accept: 'application/json', ...(hit ? { 'If-None-Match': hit.etag } : {}) } });
  if (res.status === 304 && hit) {
    hit.at = Date.now();
    return hit.body;
  }
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  detail.delete(path);
  detail.set(path, { body, etag: res.headers.get('ETag') || '', at: Date.now() });
  if (detail.size > DETAIL_MAX) detail.delete(detail.keys().next().value);
  return body;
}

/** 只读本地缓存，不发请求。没有缓存返回 null。 */
export function peek(path) {
  const c = store.get('http:' + path);
  if (!c) return null;
  return { body: c.body, at: store.get('at:' + path) || c.savedAt };
}

/** 请求一个接口。返回 { body, changed, at }；失败抛错。 */
export async function get(path) {
  const cached = store.get('http:' + path);
  const headers = { Accept: 'application/json' };
  if (cached && cached.etag) headers['If-None-Match'] = cached.etag;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, { headers, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }

  const at = Date.now();
  if (res.status === 304 && cached) {
    store.set('at:' + path, at);
    return { body: cached.body, changed: false, at };
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const body = await res.json();
  const etag = res.headers.get('ETag');
  const changed = !cached || cached.etag !== etag;
  store.set('http:' + path, { etag, body, savedAt: at });
  store.set('at:' + path, at);
  return { body, changed, at };
}

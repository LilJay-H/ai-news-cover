// 一个“数据源”：定时刷新、失败时保留旧内容并标离线、5 分钟自动重试、可暂停。
export const OFFLINE_RETRY_MS = 5 * 60 * 1000;

/**
 * fetchData(): Promise<{ data, changed, at }>
 * restore():   读本地缓存 → { data, at } | null
 * 状态 status：'loading'（还没有任何内容）| 'cached'（先显示缓存，等网络）| 'ok' | 'offline'
 */
export function createFeed({ interval, fetchData, restore }) {
  const subs = new Set();
  let timer = 0;
  let inflight = false;
  let paused = true;
  let lastRun = 0;

  let state = { status: 'loading', data: null, contentAt: null };
  try {
    const r = restore();
    if (r) state = { status: 'cached', data: r.data, contentAt: r.at };
  } catch {
    /* 缓存损坏就当没有 */
  }

  const emit = () => subs.forEach((fn) => fn(state));

  function schedule(ms) {
    clearTimeout(timer);
    if (!paused) timer = setTimeout(refresh, ms);
  }

  async function refresh() {
    if (inflight) return;
    inflight = true;
    lastRun = Date.now();
    try {
      const r = await fetchData();
      const prev = state;
      state = {
        status: 'ok',
        data: r.changed || !prev.data ? r.data : prev.data,
        contentAt: r.at,
      };
      if (r.changed || prev.status !== 'ok' || prev.data == null) emit();
      schedule(interval);
    } catch {
      state = { ...state, status: 'offline' };
      emit();
      schedule(OFFLINE_RETRY_MS);
    } finally {
      inflight = false;
    }
  }

  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
    refresh,
    start() {
      paused = false;
      refresh();
    },
    pause() {
      paused = true;
      clearTimeout(timer);
    },
    /** 暂停结束（全屏退出、唤醒、重新联网）：立刻刷新一次，不等下个整分钟。 */
    resume() {
      paused = false;
      refresh();
    },
  };
}

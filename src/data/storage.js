// 本地存储：localStorage 不可用时退回内存，不报错。
const mem = new Map();

export const store = {
  get(key) {
    if (mem.has(key)) return mem.get(key);
    try {
      const raw = localStorage.getItem('nc:' + key);
      if (raw == null) return null;
      const v = JSON.parse(raw);
      mem.set(key, v);
      return v;
    } catch {
      return null;
    }
  },
  set(key, value) {
    mem.set(key, value);
    try {
      localStorage.setItem('nc:' + key, JSON.stringify(value));
    } catch {
      /* 存储满了或被禁用：只保留内存副本 */
    }
  },
};

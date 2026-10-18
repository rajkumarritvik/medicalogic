// Simple in-memory rate limiter (per user IP, sliding window).
// Protects our Groq key and the free NCBI/MedlinePlus services from being spammed.

export function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> [timestamps]
  return {
    check(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - list[0])) / 1000) };
      }
      list.push(now);
      hits.set(key, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
      return { ok: true };
    },
  };
}

/** Tiny time-limited cache so repeated questions don't re-call PubMed and the AI. */
export function createCache({ ttlMs, maxEntries = 300 }) {
  const store = new Map();
  return {
    get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (Date.now() > e.expires) { store.delete(key); return null; }
      return e.value;
    },
    set(key, value) {
      if (store.size >= maxEntries) store.delete(store.keys().next().value);
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}

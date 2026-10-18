// Outgoing HTTP helpers: timeouts, one retry, and per-API throttles so we
// stay under each service's rate limit.

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Makes sure calls to one API are spaced at least `minIntervalMs` apart.
 * NCBI (PubMed): max 3 requests/second without an API key, 10 with one.
 * MedlinePlus: max 85 requests/minute.
 */
export function makeThrottle(minIntervalMs) {
  let nextFree = 0;
  return async function throttled(task) {
    const now = Date.now();
    const start = Math.max(now, nextFree);
    nextFree = start + minIntervalMs;
    if (start > now) await sleep(start - now);
    return task();
  };
}

export class UpstreamError extends Error {
  constructor(service, message, status) {
    super(`${service}: ${message}`);
    this.service = service;
    this.status = status;
  }
}

/** fetch with a timeout and one retry on rate-limit (429) or server (5xx) errors. */
export async function fetchWithRetry(service, url, options = {}, { timeoutMs = 12000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt < retries) { await sleep(800); continue; }
      throw new UpstreamError(service, err.name === 'TimeoutError' ? 'timed out' : err.message);
    }
    if ((res.status === 429 && service !== 'Groq' && service !== 'OpenAI' || res.status >= 500) && attempt < retries) {
      await sleep(res.status === 429 ? 1500 : 800);
      continue;
    }
    return res;
  }
}

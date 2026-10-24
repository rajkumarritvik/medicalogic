// Calls the language model (Groq by default, OpenAI optional) and asks for JSON.

import { fetchWithRetry, UpstreamError } from './http.js';

const GROQ_BASE = () => process.env.GROQ_BASE || 'https://api.groq.com/openai/v1';
const OPENAI_BASE = () => process.env.OPENAI_BASE || 'https://api.openai.com/v1';

// Picks a Groq chat model this API key can use. Set GROQ_MODEL in .env to force one.
// Otherwise: list the key's models, skip audio/safety ones, prefer big chat models,
// and send each a tiny test message until one works.
let cachedGroqModel = process.env.GROQ_MODEL || null;
export async function getGroqModel() {
  if (cachedGroqModel) return cachedGroqModel;
  const headers = { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' };
  const r = await fetchWithRetry('Groq', `${GROQ_BASE()}/models`, { headers });
  const data = await r.json();
  if (!r.ok) throw new UpstreamError('Groq', data.error?.message || 'could not list models', r.status);
  const ids = data.data.filter(m => m.active !== false).map(m => m.id);
  console.log('Groq models on this key:', ids.join(', '));
  const notChat = /whisper|tts|orpheus|playai|guard|embed|distil|compound/i;
  const rank = [/llama.*(70b|405b|maverick)/i, /gpt-oss-120b/i, /llama.*scout/i, /(qwen|kimi|deepseek|mistral|gpt-oss)/i, /llama/i, /./];
  const score = id => rank.findIndex(re => re.test(id));
  const candidates = ids.filter(id => !notChat.test(id)).sort((a, b) => score(a) - score(b));
  for (const id of candidates) {
    const test = await fetchWithRetry('Groq', `${GROQ_BASE()}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: id, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }),
    });
    if (test.ok) {
      cachedGroqModel = id;
      console.log(`Using Groq model: ${id}`);
      return id;
    }
    console.log(`Skipping ${id} (test message failed)`);
  }
  throw new UpstreamError('Groq', 'no chat model on this key accepted a test message');
}

let useReasoningEffort = true;

async function chat(service, base, key, model, system, user, jsonMode, maxTokens) {
  const body = {
    model,
    temperature: 0,
    max_tokens: maxTokens || Number(process.env.LLM_MAX_TOKENS || 2000),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  // gpt-oss models "think" before answering; low effort uses far fewer tokens per claim.
  if (useReasoningEffort && /gpt-oss/i.test(model)) body.reasoning_effort = process.env.REASONING_EFFORT || 'low';
  const res = await fetchWithRetry(service, `${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs: 45000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UpstreamError(service, data.error?.message || `HTTP ${res.status}`, res.status);
  return { text: data.choices?.[0]?.message?.content || '', usage: data.usage || null, model };
}

/** @returns {{text: string, usage: object|null, model: string}} */
export async function complete({ system, user, provider = 'groq', maxTokens }) {
  const isOpenAI = provider === 'openai';
  const service = isOpenAI ? 'OpenAI' : 'Groq';
  const key = isOpenAI ? process.env.OPENAI_API_KEY : process.env.GROQ_API_KEY;
  if (!key) throw new UpstreamError(service, `${isOpenAI ? 'OPENAI' : 'GROQ'}_API_KEY is missing from .env`);
  const base = isOpenAI ? OPENAI_BASE() : GROQ_BASE();
  const model = isOpenAI ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : await getGroqModel();
  let jsonMode = true;
  for (let attempt = 0; ; attempt++) {
    try {
      return await chat(service, base, key, model, system, user, jsonMode, maxTokens);
    } catch (err) {
      // Some models don't support JSON mode - try again without it.
      if (err.status === 400 && jsonMode && /response_format|json/i.test(err.message)) { jsonMode = false; continue; }
      if (err.status === 400 && useReasoningEffort && /reasoning/i.test(err.message)) { useReasoningEffort = false; continue; }
      // Free-tier rate limit: Groq says "Please try again in 3.2s" - wait that long and retry (up to 3 times).
      const wait = err.message.match(/try again in ([\d.]+)s/i);
      if ((err.status === 429 || wait) && attempt < 3) {
        const sec = Math.min(Math.ceil(Number(wait?.[1] || 10)) + 1, 30);
        console.log(`  Groq rate limit - waiting ${sec}s and retrying...`);
        await new Promise(r => setTimeout(r, sec * 1000));
        continue;
      }
      throw err;
    }
  }
}

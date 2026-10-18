// MedicaLogic backend v2
//   POST /api/verify   { "query": "...", "lang": "en" | "ar" }   -> evidence-backed verdict (see API.md)
//   GET  /api/health                                              -> is the server up?
//
// Built from Mohanned's v1 server (Express + zero-memory prompt), extended for Phase 2:
// curated myth database, live PubMed + MedlinePlus retrieval, System Prompt v2.0,
// fallback for unmapped claims, rate limiting, and validated JSON responses.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, '.env') });

// Imported after .env is loaded so settings like NCBI_API_KEY are visible.
const { loadMyths, mythCount } = await import('./lib/curated.js');
const { verifyClaim, setDataDir } = await import('./lib/pipeline.js');
const { validateRequest, RequestError } = await import('./lib/validate.js');
const { createLimiter } = await import('./lib/ratelimit.js');
const { UpstreamError } = await import('./lib/http.js');
const { PROMPT_VERSION } = await import('./lib/prompts.js');

const PORT = process.env.PORT || 5000;
const info = loadMyths(serverDir);
setDataDir(serverDir);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10kb' }));

const limiter = createLimiter({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN || 20) });
const sendError = (res, status, code, message, extra = {}) =>
  res.status(status).json({ success: false, error: { code, message, ...extra } });

app.get('/api/health', (req, res) => {
  res.json({ ok: true, curated_claims: mythCount(), prompt_version: PROMPT_VERSION });
});

app.post('/api/verify', async (req, res) => {
  const ip = req.ip || 'local';
  const gate = limiter.check(ip);
  if (!gate.ok) {
    res.set('Retry-After', String(gate.retryAfterSec));
    return sendError(res, 429, 'RATE_LIMITED', `Too many requests. Try again in ${gate.retryAfterSec}s.`);
  }
  try {
    const input = validateRequest(req.body);
    const result = await verifyClaim({ ...input, ip });
    console.log(`[${result.tier}] ${result.verdict} ${result.meta.latency_ms}ms "${input.query.slice(0, 60)}"` +
      (result.meta.warnings.length ? `  warnings: ${result.meta.warnings.join(' | ')}` : ''));
    return res.json(result);
  } catch (err) {
    if (err instanceof RequestError) {
      if (err.retryAfterSec) res.set('Retry-After', String(err.retryAfterSec));
      return sendError(res, err.status, err.code, err.message);
    }
    if (err instanceof UpstreamError) {
      console.error('Upstream error:', err.message);
      return sendError(res, 502, 'AI_UNAVAILABLE', 'The AI service is not responding right now. Please try again.', { detail: err.message });
    }
    console.error('Unexpected error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Something went wrong on our side.');
  }
});

// Bad JSON in the request body
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return sendError(res, 400, 'BAD_JSON', 'Request body is not valid JSON.');
  if (err?.type === 'entity.too.large') return sendError(res, 413, 'TOO_LARGE', 'Request body is too large.');
  return next(err);
});

app.listen(PORT, () => {
  console.log(`MedicaLogic server v2 running on http://localhost:${PORT}`);
  console.log(`Curated myths loaded: ${info.loaded} (hidden as holdout: ${info.hidden}) from ${info.path}`);
  if (!process.env.GROQ_API_KEY) console.log('WARNING: GROQ_API_KEY is not set in server/.env');
});

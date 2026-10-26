# MedicaLogic API (backend v2)

Base URL (local): `http://localhost:5000`

## POST /api/verify

Request:

```json
{ "query": "Does alkaline water kill cancer cells?", "lang": "en" }
```

| field | required | notes |
|---|---|---|
| `query` | yes | 3–2000 characters (a pasted post is fine) |
| `lang` | no | `"en"` (default) or `"ar"`; with `"ar"`, summary, true/overstated and notes come back in Arabic. Arabic claims are translated to English behind the scenes only for matching and PubMed search (`meta.search_text_en`) |
| `provider` | no | `"groq"` (default) or `"openai"` |

Example from the website (`app.js`):

```js
const res = await fetch('http://localhost:5000/api/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: cleanedQuery, lang: currentLang }),
});
const data = await res.json();
if (!data.success) showError(data.error.message);   // ready-to-show message
else renderAnswerCard(data);
```

### Success response (HTTP 200)

```json
{
  "success": true,
  "query": "Does alkaline water kill cancer cells?",
  "lang": "en",
  "tier": "live",
  "verdict": "Refuted",
  "summary": "Plain-language answer, at most 150 words.",
  "true_part": "Tumors do create an acidic environment around themselves.",
  "overstated_part": "Drinking alkaline water does not change blood pH or treat cancer.",
  "sources": [
    {
      "pmid": "27297008",
      "title": "Systematic review of the association between dietary acid load, alkaline water and cancer",
      "journal": "BMJ Open",
      "year": 2016,
      "study_type": "Systematic Review",
      "url": "https://pubmed.ncbi.nlm.nih.gov/27297008/",
      "relevance": "direct",
      "note": "No evidence that alkaline water treats or prevents cancer."
    }
  ],
  "consumer_info": [
    { "title": "Cancer", "url": "https://medlineplus.gov/cancer.html", "snippet": "…", "source": "MedlinePlus" }
  ],
  "curated": null,
  "manipulation": {
    "score": 61, "level": "high",
    "tags": [ { "key": "absolutism", "label": "Absolutism", "points": 18 } ],
    "parts": { "absolutism": 18, "fear": 9, "sensational": 14, "hedging": 20 },
    "matches": { "absolutism": ["guaranteed", "cures"], "fear": ["toxins"], "sensational": ["miracle"], "hedges": [],
                 "exclamation_marks": 2, "all_caps_words": [] },
    "explanation": "We think this wording is highly manipulative. Words like 'guaranteed' and 'cures' add pressure instead of evidence."
  },
  "evidence_last_checked": "2026-10-18",
  "disclaimer": "MedicaLogic summarizes published research for education. It is literature-based, not a medical ruling…",
  "meta": {
    "prompt_version": "2.2", "provider": "groq", "model": "openai/gpt-oss-120b",
    "latency_ms": 2140, "usage": { "total_tokens": 1830 }, "cached": false,
    "retrieved": { "pubmed": 4, "medlineplus": 1 },
    "search_text_en": null,
    "search_queries": ["alkaline water cancer", "dietary acid load cancer"],
    "retrieved_articles": [ { "pmid": "27297008", "title": "…", "study_type": "Systematic Review" } ], "warnings": []
  }
}
```

### Which field goes where on the Answer Card

| Answer Card part | Field |
|---|---|
| Evidence Badge | `verdict`: `Supported` / `Refuted` / `Divergent` / `Insufficient` |
| Summary (<150 words) | `summary` |
| "What's true / What's overstated" | `true_part`, `overstated_part` (either can be `""`) |
| PMID list + direct/indirect notes | `sources[]`: `pmid`, `title`, `year`, `study_type`, `url`, `relevance`, `note` |
| "Learn more" links | `consumer_info[]` (MedlinePlus pages) |
| Timestamp | `evidence_last_checked` |
| Disclaimer | `disclaimer` (already in the right language) |
| Fallback state | `tier === "fallback"` (always with `verdict === "Insufficient"` and `sources: []`) |
| Manipulation Meter (every claim) | `manipulation.score` (0–100), `manipulation.level` (low/moderate/high), `manipulation.tags[]`, `manipulation.explanation`; words to highlight in `manipulation.matches` |
| Risk level + advice (curated claims only) | `curated.risk_level`, `curated.recommended_action`, `curated.advice_source` |

`tier` tells you where the answer came from:

- `"curated"`: matched a claim in our database (`myths.json`); `curated` has the extra fields above.
- `"live"`: a new claim, answered from a live PubMed search; `curated` is `null`.
- `"fallback"`: not enough verified evidence. Show the "Insufficient" state; the claim is logged for the team to research.

Rules the server enforces, so the website doesn't need to:

- Every PMID in `sources` was retrieved from PubMed. Any PMID the AI made up is removed before the response is sent.
- `verdict` is always one of the 4 values.
- `summary` is at most 150 words.

### Error response

```json
{ "success": false, "error": { "code": "RATE_LIMITED", "message": "Too many requests. Try again in 20s." } }
```

| HTTP | code | meaning |
|---|---|---|
| 400 | `QUERY_TOO_SHORT`, `QUERY_TOO_LONG`, `BAD_LANG`, `BAD_PROVIDER`, `BAD_JSON` | bad request |
| 429 | `RATE_LIMITED` | too many requests (also a `Retry-After` header in seconds) |
| 502 | `AI_UNAVAILABLE`, `BAD_MODEL_OUTPUT` | the AI service failed |
| 503 | `SOURCES_UNAVAILABLE` | PubMed is down |
| 500 | `SERVER_ERROR` | anything else |

`error.message` is safe to show to users as it is.

The Manipulation Meter only looks at the wording (absolutism, fear/conspiracy, sensationalism, lack of hedging, up to 25 points each), not at whether the claim is true. Word lists are in `lib/manipulation.js`.

## GET /api/unanswered

Every claim that came back `Insufficient` is saved in `server/data/unanswered_claims.json`, grouped (same keywords = same claim; Arabic claims grouped by their English translation) and listed most-asked first. Optional `?limit=50`.

```json
{ "success": true, "total": 1, "claims": [
  { "key": "baldness cures eating moon rocks", "count": 2,
    "examples": ["Eating moon rocks cures baldness", "أكل صخور القمر يعالج الصلع"],
    "english": "Eating moon rocks cures baldness", "langs": ["en", "ar"],
    "reasons": { "no_pubmed_results": 2 }, "status": "new",
    "first_seen": "2026-10-25T18:00:00Z", "last_seen": "2026-10-25T18:05:00Z" } ] }
```

## GET /api/health

```json
{ "ok": true, "curated_claims": 9, "prompt_version": "2.2" }
```

## Settings (`server/.env`)

| name | default | purpose |
|---|---|---|
| `GROQ_API_KEY` | – | required |
| `PORT` | 5000 | |
| `GROQ_MODEL` | auto-picked | force a specific Groq model |
| `NCBI_API_KEY` | – | optional free NCBI key: raises the PubMed limit from 3 to 10 requests/second |
| `NCBI_EMAIL` | – | optional contact email NCBI asks for |
| `PUBMED_SORT` | `relevance` | `pub_date` = newest papers first |
| `PUBMED_MAX_RESULTS` | 4 | papers per live search |
| `ABSTRACT_MAX_CHARS` | 1000 | characters of each abstract sent to the AI (fewer = fewer tokens) |
| `REASONING_EFFORT` | low | for gpt-oss models: low / medium / high (higher = slower, more tokens) |
| `RATE_LIMIT_PER_MIN` | 20 | requests per user per minute |
| `LIVE_LIMIT_PER_MIN` | 8 | new (non-curated) claims per user per minute |
| `CACHE_TTL_MINUTES` | 360 | repeated questions are answered from memory |
| `SEARCH_TERM_SUGGESTIONS` | on | `off` = skip the AI step that turns a new claim into medical PubMed search terms (live tier only) |
| `CURATED_MATCH_THRESHOLD` | 0.5 | how closely a question must match a curated claim (0–1) |
| `UNANSWERED_DB` | `server/data/unanswered_claims.json` | where unanswered claims are saved |

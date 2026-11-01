"""
evaluate.py  -  MedicaLogic multi-source RAG test harness (v2).

Sends every benchmark claim to the running server (POST /api/verify) and scores the answers.

Two sets (see holdout.json):
  CORE     the 5 core claims (multi-source, team-verified). Curated tier. The headline benchmark.
  TUNING   other claims the server knows (curated tier). Tests answers built from the team's sources.
  HOLDOUT  claims hidden from the server. Tests the live PubMed tier on claims it has never seen.
           Never tune the prompt on these, or the test stops being fair.
Plus PROBES: made-up claims with no research behind them. A grounded system must answer
"Insufficient" instead of making something up (zero-memory / fallback check).

Metrics
  verdict accuracy     verdict matches the team's verdict
  tier correct         tuning -> "curated", holdout -> "live"
  team-PMID recall     share of the team's PMIDs the answer cited (holdout: did live search find them?)
  has direct source    at least one cited source studies the exact claim
  systematic share     share of cited sources that are systematic reviews / meta-analyses
  summary <=150 words  length rule from System Prompt v2.0
  true/overstated      both parts filled in (Jiayi's rule)
  fabrications blocked PMIDs the AI invented that the server removed (should be 0, and never shown)
  latency              seconds per answer (avg and 95th percentile)

Run:
  python evaluate.py                     (server must be running: node server.js)
  python evaluate.py --set holdout       (only holdout claims)
  python evaluate.py --lang ar           (test Arabic answers)
  python evaluate.py --mock              (fake answers, no server - checks the harness itself)
  python evaluate.py --data fresh_claims.json --out fresh_results.csv
                                         (FRESH set: brand-new myths never seen or tuned on - fair test of the live search)
  python evaluate.py --delay 10          (wait longer between claims if Groq rate-limits you)
Results go to results.csv (one row per claim). Uses only built-in Python.
"""
import argparse
import csv
import json
import random
import statistics
import time
import urllib.error
import urllib.request

PROBES = [
    "Eating moon rocks cures baldness",
    "Wearing purple socks raises your IQ by 20 points",
    "Whispering to houseplants cures migraines overnight",
]
STRONG = {"Systematic Review", "Meta-Analysis"}


def post(url, payload, timeout=90):
    """POST JSON; waits and retries if the server says we are rate limited."""
    body = json.dumps(payload).encode()
    for attempt in range(4):
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            data = json.loads(e.read().decode() or "{}")
            if e.code == 429 and attempt < 3:
                wait = int(e.headers.get("Retry-After") or 30)
                print(f"   rate limited - waiting {wait}s ...")
                time.sleep(wait + 1)
                continue
            raise RuntimeError(data.get("error", {}).get("message", f"HTTP {e.code}"))


def mock_answer(claim, myth, is_probe):
    """Fake server reply in the v2 format (for testing this script only)."""
    time.sleep(random.uniform(0.05, 0.2))
    if is_probe or myth is None:
        return {"success": True, "tier": "fallback", "verdict": "Insufficient", "summary": "Not enough evidence.",
                "true_part": "", "overstated_part": "", "sources": [], "meta": {"warnings": [], "usage": None}}
    srcs = [{"pmid": e["pmid"], "study_type": e["study_type"], "relevance": e["relevance"]} for e in myth["evidence"]]
    if random.random() < 0.3:
        srcs = srcs[:-1] or srcs
    return {"success": True, "tier": "live" if myth["_set"] == "holdout" else "curated",
            "verdict": myth["verdict"] if random.random() < 0.9 else "Divergent",
            "summary": "word " * random.randint(60, 140), "true_part": "x", "overstated_part": "y",
            "sources": srcs, "meta": {"warnings": [], "usage": {"total_tokens": random.randint(800, 1500)}}}


def score_claim(myth, resp, latency):
    expected = [str(e["pmid"]) for e in myth["evidence"]]
    cited = [str(s["pmid"]) for s in resp.get("sources", [])]
    hits = len(set(cited) & set(expected))
    warnings = resp.get("meta", {}).get("warnings", [])
    usage = resp.get("meta", {}).get("usage") or {}
    return {
        "id": myth["id"],
        "set": myth["_set"],
        "expected_tier": "live" if myth["_set"] in ("holdout", "fresh") else "curated",
        "tier": resp.get("tier", ""),
        "expected_verdict": myth["verdict"],
        "verdict": resp.get("verdict", ""),
        "verdict_correct": resp.get("verdict") in myth.get("accept_verdicts", [myth["verdict"]]),
        "team_pmid_recall": round(hits / len(expected), 2) if expected else "",
        "has_direct_source": any(s.get("relevance") == "direct" for s in resp.get("sources", [])),
        "systematic_share": round(sum(s.get("study_type") in STRONG for s in resp.get("sources", [])) / len(cited), 2) if cited else 0,
        "summary_words": len(resp.get("summary", "").split()),
        "true_overstated_filled": bool(resp.get("true_part")) and bool(resp.get("overstated_part")),
        "fabrications_blocked": sum("possible fabrication" in w for w in warnings),
        "latency_s": round(latency, 2),
        "tokens": usage.get("total_tokens", ""),
        "cited_pmids": ";".join(cited),
        "team_pmids": ";".join(expected),
        "summary": resp.get("summary", "").replace("\n", " "),
        "retrieved_papers": " | ".join(f"{a['pmid']} {a['title'][:70]}" for a in resp.get("meta", {}).get("retrieved_articles", [])),
        "error": "",
    }


def pct(rows, key):
    return f"{sum(bool(r[key]) for r in rows) / len(rows):.0%}" if rows else "-"


def avg(rows, key):
    vals = [r[key] for r in rows if r[key] != ""]
    return f"{statistics.mean(vals):.2f}" if vals else "-"


def main():
    ap = argparse.ArgumentParser(description="Evaluate the MedicaLogic v2 server.")
    ap.add_argument("--url", default="http://localhost:5000/api/verify")
    ap.add_argument("--data", default="myths.json")
    ap.add_argument("--holdout", default="holdout.json")
    ap.add_argument("--set", default="all", choices=["all", "core", "holdout", "tuning", "fresh"])
    ap.add_argument("--lang", default="en", choices=["en", "ar"])
    ap.add_argument("--out", default="results.csv")
    ap.add_argument("--no-probes", action="store_true")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--delay", type=float, default=6,
                    help="seconds to wait between claims (Groq free tier allows ~8000 tokens/minute)")
    args = ap.parse_args()
    random.seed(42)

    myths = json.load(open(args.data, encoding="utf-8"))
    try:
        sets = json.load(open(args.holdout, encoding="utf-8"))
    except FileNotFoundError:
        sets = {}
    hold, core = set(sets.get("holdout_ids", [])), set(sets.get("core_ids", []))
    for m in myths:
        m["_set"] = "fresh" if m.get("fresh") else ("holdout" if m["id"] in hold else ("core" if m["id"] in core else "tuning"))
    todo = [m for m in myths if args.set == "all" or m["_set"] == args.set]
    if not args.mock and any(m["_set"] == "holdout" for m in todo):
        try:
            import urllib.request
            health = json.load(urllib.request.urlopen(args.url.replace("/api/verify", "/api/health"), timeout=10))
            if not health.get("holdout_hidden"):
                print("WARNING: the server can see the holdout claims, so the holdout test is not fair.")
                print('  Restart the server with:  $env:HIDE_HOLDOUT="on"; node server.js   (then run this again)')
        except Exception:
            pass

    rows = []
    for m in todo:
        t0 = time.perf_counter()
        try:
            resp = mock_answer(m["claim_text"], m, False) if args.mock else post(args.url, {"query": m["claim_text"], "lang": args.lang})
            row = score_claim(m, resp, time.perf_counter() - t0)
        except Exception as exc:
            row = {"id": m["id"], "set": m["_set"], "error": str(exc)}
        rows.append(row)
        if not args.mock and args.delay:
            time.sleep(args.delay)
        if row.get("error"):
            print(f"[ERR ] {row['id']} ({row['set']})  {row['error']}")
        else:
            ok = "OK  " if row["verdict_correct"] else "MISS"
            print(f"[{ok}] {row['id']} ({row['set']:7}) tier={row['tier']:8} verdict={row['verdict']:12} "
                  f"recall={row['team_pmid_recall'] if row['team_pmid_recall'] == '' else format(row['team_pmid_recall'], '.2f'):>4} words={row['summary_words']:3} {row['latency_s']}s")

    probe_rows = []
    if not args.no_probes and args.set not in ("tuning", "core"):
        print("\nZero-memory probes (made-up claims, expected: Insufficient)")
        for p in PROBES:
            t0 = time.perf_counter()
            try:
                resp = mock_answer(p, None, True) if args.mock else post(args.url, {"query": p, "lang": args.lang})
                passed = resp.get("verdict") == "Insufficient"
                probe_rows.append({"probe": p, "verdict": resp.get("verdict"), "tier": resp.get("tier"),
                                   "pass": passed, "latency_s": round(time.perf_counter() - t0, 2)})
                print(f"[{'PASS' if passed else 'FAIL'}] {p!r} -> {resp.get('verdict')} ({resp.get('tier')})")
                if not args.mock and args.delay:
                    time.sleep(args.delay)
            except Exception as exc:
                probe_rows.append({"probe": p, "verdict": "", "tier": "", "pass": False, "latency_s": 0})
                print(f"[ERR ] {p!r}  {exc}")

    fields = ["id", "set", "expected_tier", "tier", "expected_verdict", "verdict", "verdict_correct",
              "team_pmid_recall", "has_direct_source", "systematic_share", "summary_words",
              "true_overstated_filled", "fabrications_blocked", "latency_s", "tokens",
              "cited_pmids", "team_pmids", "summary", "retrieved_papers", "error"]
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, restval="")
        w.writeheader()
        w.writerows(rows)

    print("\n================ SUMMARY ================")
    print(f"Mode: {'MOCK (fake answers)' if args.mock else args.url}   language: {args.lang}")
    good = [r for r in rows if not r.get("error")]
    for name in ["core", "tuning", "holdout", "fresh"]:
        rs = [r for r in good if r["set"] == name]
        if not rs:
            continue
        rs_tier = [r for r in rs if r["tier"] == r["expected_tier"]]
        print(f"\n{name.upper()} ({len(rs)} claims)")
        print(f"  Verdict accuracy:      {pct(rs, 'verdict_correct')}")
        print(f"  Tier correct:          {len(rs_tier)}/{len(rs)}")
        print(f"  Team-PMID recall:      {avg(rs, 'team_pmid_recall')}")
        print(f"  Has a direct source:   {pct(rs, 'has_direct_source')}")
        print(f"  Systematic share:      {avg(rs, 'systematic_share')}")
        print(f"  Summary <=150 words:   {sum(r['summary_words'] <= 150 for r in rs)}/{len(rs)}")
        print(f"  True/overstated filled:{pct(rs, 'true_overstated_filled'):>5}")
        print(f"  Fabrications blocked:  {sum(r['fabrications_blocked'] for r in rs)}")
        lats = sorted(r["latency_s"] for r in rs)
        print(f"  Latency avg / p95:     {statistics.mean(lats):.2f}s / {lats[min(len(lats) - 1, int(0.95 * len(lats)))]:.2f}s")
    if probe_rows:
        print(f"\nZero-memory probes passed: {sum(p['pass'] for p in probe_rows)}/{len(probe_rows)}")
    errors = len(rows) - len(good)
    if errors:
        print(f"\nErrors: {errors} (see the 'error' column in {args.out})")
    print(f"\nSaved per-claim details to {args.out}")


if __name__ == "__main__":
    main()

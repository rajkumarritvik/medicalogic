"""
validate_myths.py  -  checks every record in myths.json against the v2 schema rules.

Run:  python validate_myths.py              (checks myths.json)
      python validate_myths.py other.json   (checks another file)

Errors   = must fix before the server can use the record.
Warnings = still OK to use, but a researcher should look (e.g. drafted fields, unverified PMIDs).
Uses only built-in Python, nothing to install.
"""
import json
import re
import sys

PLATFORMS = {"TikTok", "Instagram", "X", "YouTube", "Facebook", "Other"}
RISKS = {"Low", "Medium", "High"}
VERDICTS = {"Supported", "Refuted", "Divergent", "Insufficient"}
STUDY_TYPES = {"Systematic Review", "Meta-Analysis", "RCT", "Review", "Case Report", "Guideline", "Other"}
RELEVANCE = {"direct", "indirect"}
DISORDER = {"Misinformation", "Disinformation", "Malinformation"}
REQUIRED = ["id", "claim_text", "category", "platform_origin", "raw_quotes", "manipulation_markers",
            "risk_classification", "verdict", "true_part", "overstated_part", "evidence",
            "recommended_action", "evidence_last_checked"]


def check_record(rec):
    """Return (errors, warnings) for one myth record."""
    errs, warns = [], []
    for field in REQUIRED:
        if field not in rec:
            errs.append(f"missing field '{field}'")
    if errs:
        return errs, warns

    if not re.fullmatch(r"MYTH-\d{3}", rec["id"]):
        errs.append("id must look like MYTH-001")
    if len(rec["claim_text"].strip()) < 10:
        errs.append("claim_text is too short")
    plats = rec["platform_origin"]
    if not isinstance(plats, list) or not plats or any(p not in PLATFORMS for p in plats):
        errs.append(f"platform_origin must be a list using only {sorted(PLATFORMS)}")
    if rec["risk_classification"] not in RISKS:
        errs.append(f"risk_classification must be one of {sorted(RISKS)}")
    if rec["verdict"] not in VERDICTS:
        errs.append(f"verdict must be one of {sorted(VERDICTS)}")
    if not rec["raw_quotes"]:
        errs.append("raw_quotes needs at least one quote")
    for key in ["true_part", "overstated_part", "recommended_action"]:
        if not str(rec.get(key, "")).strip():
            errs.append(f"{key} is empty")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(rec["evidence_last_checked"])):
        errs.append("evidence_last_checked must be a date like 2026-10-11")

    mm = rec["manipulation_markers"]
    for key in ["clickbait_phrases", "absolute_promises", "fear_keywords"]:
        if not isinstance(mm.get(key), list):
            errs.append(f"manipulation_markers.{key} must be a list")

    if not rec["evidence"]:
        errs.append("evidence needs at least one study")
    pmids = []
    for i, ev in enumerate(rec["evidence"]):
        pmid = str(ev.get("pmid", ""))
        pmids.append(pmid)
        if not re.fullmatch(r"\d{1,9}", pmid) or set(pmid) == {"0"}:
            errs.append(f"evidence[{i}].pmid must be a real PubMed ID (digits only)")
        if not ev.get("title") or str(ev["title"]).startswith("REPLACE"):
            errs.append(f"evidence[{i}].title is missing (run: py verify_pmids.py --write to fill it from PubMed)")
        if ev.get("study_type") not in STUDY_TYPES:
            errs.append(f"evidence[{i}].study_type must be one of {sorted(STUDY_TYPES)}")
        if ev.get("relevance") not in RELEVANCE:
            errs.append(f"evidence[{i}].relevance must be 'direct' or 'indirect'")
        if not str(ev.get("note", "")).strip():
            warns.append(f"evidence[{i}] (PMID {pmid}) has no one-line note on what the study shows")
    if len(set(pmids)) != len(pmids):
        errs.append("the same PMID is listed twice")

    if rec.get("information_disorder_type") not in DISORDER:
        errs.append(f"information_disorder_type must be one of {sorted(DISORDER)}")

    # Warnings (Jiayi's checklist)
    types = {ev.get("study_type") for ev in rec["evidence"]}
    if not types & {"Systematic Review", "Meta-Analysis"}:
        warns.append("no systematic review / meta-analysis (preferred, not required)")
    if not any(ev.get("relevance") == "direct" for ev in rec["evidence"]):
        warns.append("no 'direct' source - verdict rests on indirect evidence only")
    if len(rec["evidence"]) < 2:
        warns.append("only 1 source (Jiayi suggests a few: mechanism + safety/outcomes)")
    if not rec.get("pmid_verified"):
        warns.append("PMIDs not verified yet - run verify_pmids.py")
    for item in rec.get("needs_review", []):
        warns.append(f"needs review: {item}")
    return errs, warns


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else "myths.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        print("The file must contain a JSON list [ ... ] of myth records.")
        sys.exit(1)

    ids, bad, warned = set(), 0, 0
    for rec in data:
        rid = rec.get("id", "?")
        errs, warns = check_record(rec)
        if rid in ids:
            errs.append("duplicate id")
        ids.add(rid)
        status = "X " if errs else ("! " if warns else "OK")
        print(f"[{status}] {rid}  {rec.get('claim_text', '')[:60]}")
        for e in errs:
            print(f"     ERROR: {e}")
        if "--quiet" not in sys.argv:
            for w in warns:
                print(f"     warn:  {w}")
        bad += bool(errs)
        warned += bool(warns) and not errs

    print(f"\n{len(data) - bad}/{len(data)} records usable ({warned} with warnings to review).")
    print("Tip: add --quiet to hide warnings.")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

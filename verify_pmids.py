"""
verify_pmids.py  -  checks every PMID in myths.json against PubMed itself.

Jiayi's rule: only use PMIDs you have checked on PubMed, because AI (and typos) can
produce citations that don't exist. This script asks PubMed for each PMID and checks
that the title matches what we wrote down.

Run:   python verify_pmids.py            (just report)
       python verify_pmids.py --write    (also fill in missing titles/journal/year from PubMed, and set
                                          "pmid_verified": true on myths where every PMID matched)

Results:  OK        PMID exists and the title matches
          MISMATCH  PMID exists but is a DIFFERENT paper -> fix the PMID or the title
          NOT FOUND PMID does not exist on PubMed -> wrong number
Uses only built-in Python. Needs internet (works on your computer, not on Colab-free networks that block NCBI).
"""
import difflib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = os.environ.get("PUBMED_BASE", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils")


def norm(t):
    return re.sub(r"[^a-z0-9 ]", " ", (t or "").lower()).split()


def similar(a, b):
    return difflib.SequenceMatcher(None, " ".join(norm(a)), " ".join(norm(b))).ratio()


def esummary(pmids):
    params = urllib.parse.urlencode({"db": "pubmed", "retmode": "json", "id": ",".join(pmids), "tool": "medicalogic"})
    with urllib.request.urlopen(f"{BASE}/esummary.fcgi?{params}", timeout=20) as r:
        return json.loads(r.read().decode()).get("result", {})


def main():
    write = "--write" in sys.argv
    path = next((a for a in sys.argv[1:] if not a.startswith("--")), "myths.json")
    myths = json.load(open(path, encoding="utf-8"))

    wanted = []  # (myth, pmid, our_title)
    evidence_of = {}  # (myth id, pmid) -> evidence dict, so --write can fill missing details
    for m in myths:
        for ev in m.get("evidence", []):
            wanted.append((m, str(ev["pmid"]), ev.get("title", "")))
            evidence_of[(m["id"], str(ev["pmid"]))] = ev
        for p in m.get("safety_pmids", []):
            wanted.append((m, str(p), ""))

    pmids = sorted({p for _, p, _ in wanted})
    found = {}
    for i in range(0, len(pmids), 50):
        found.update(esummary(pmids[i:i + 50]))
        time.sleep(0.4)  # NCBI allows 3 requests/second without a key

    bad_myths, counts = set(), {"OK": 0, "MISMATCH": 0, "NOT FOUND": 0}
    for m, pmid, ours in wanted:
        rec = found.get(pmid, {})
        theirs = rec.get("title", "") if not rec.get("error") else ""
        if not theirs:
            status = "NOT FOUND"
        elif not ours or similar(ours, theirs) >= 0.85:
            status = "OK"
            ev = evidence_of.get((m["id"], pmid))
            if ev is not None and not ours and write:
                ev["title"] = theirs.rstrip(".")
                ev["journal"] = ev.get("journal") or rec.get("source", "")
                ev["year"] = ev.get("year") or int(str(rec.get("pubdate", "0"))[:4] or 0) or None
                ev["authors"] = ev.get("authors") or [a["name"] for a in rec.get("authors", [])][:6]
        else:
            status = "MISMATCH"
        counts[status] += 1
        if status != "OK":
            bad_myths.add(m["id"])
        line = f"[{status:9}] {m['id']}  PMID {pmid}"
        if status == "MISMATCH":
            line += f"\n      we wrote: {ours[:100]}\n      PubMed:   {theirs[:100]}"
        elif status == "OK" and not ours:
            kind = "new - title filled in" if (m["id"], pmid) in evidence_of and write else ("new" if (m["id"], pmid) in evidence_of else "safety PMID")
            line += f"  ({kind}: {theirs[:70]})"
        print(line)

    print(f"\nOK: {counts['OK']}   MISMATCH: {counts['MISMATCH']}   NOT FOUND: {counts['NOT FOUND']}")
    if write:
        for m in myths:
            m["pmid_verified"] = m["id"] not in bad_myths
        json.dump(myths, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        print(f"Updated pmid_verified in {path}.")
    else:
        print("Run with --write to mark fully-verified myths in myths.json.")


if __name__ == "__main__":
    main()

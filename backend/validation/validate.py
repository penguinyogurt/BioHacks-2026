"""Blinded, paired top-five review. Python 3 standard library only."""
import argparse
import csv
import hashlib
import itertools
import json
import os
from pathlib import Path
import random
import re
import shutil
import tempfile

ID = "compound_id"
EVIDENCE = ["supporting", "contrary", "unknowns", "citations"]
QUESTIONS = {"als": "Does this compound merit an ALS follow-up experiment?",
             "ultrasound": "Is there a compound-specific rationale for testing focused-ultrasound delivery?"}
FIELDS = ["packet", "neutral_id", "reviewer"] + [
    f"{q}_{field}" for q in QUESTIONS for field in ("answer", "rationale", "experiment", "readout")
] + ["target_tissue", "exposure_evidence"]
METHODS = ("backend", "baseline", "random")


def rows(path, fields):
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != fields:
            raise ValueError(f"{path}: expected {fields}")
        result = []
        for row in reader:
            if None in row or None in row.values():
                raise ValueError(f"{path}: malformed row {reader.line_num}")
            result.append({k: v.strip() for k, v in row.items()})
        return result


def indexed(path, fields):
    result = {}
    for row in rows(path, [ID] + fields):
        key = row.pop(ID)
        if not re.fullmatch(r"Compound::DB[0-9]{5}", key) or key in result:
            raise ValueError(f"{path}: invalid or duplicate ID {key}")
        if not all(row.values()):
            raise ValueError(f"{path}: use explicit unknowns for {key}")
        result[key] = row
    return result


def write_csv(path, fields, records):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fields)
        writer.writeheader()
        writer.writerows(records)


def dump(path, obj):
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def prepare(a):
    pool = indexed(a.pool, ["name"])
    lists = {m: list(indexed(getattr(a, m), [])) for m in METHODS[:2]}
    for method, ids in lists.items():
        if len(ids) > 5 or set(ids) - pool.keys():
            raise ValueError(f"{method}: expected up to five eligible drugs")
    rng = random.Random(a.seed)
    lists["random"] = rng.sample(sorted(pool), min(5, len(pool)))
    order = sorted(set(itertools.chain.from_iterable(lists.values())))
    rng.shuffle(order)
    labels = {k: f"R{i:02}" for i, k in enumerate(order, 1)}
    evidence = indexed(a.evidence, EVIDENCE)
    if set(order) - evidence.keys():
        raise ValueError("Evidence table lacks selected drugs; prepare uniform evidence for the pool")
    case = a.case.read_text(encoding="utf-8").strip()
    if not case:
        raise ValueError("Empty case")
    records = [dict(neutral_id=labels[k], name=pool[k]["name"], **evidence[k]) for k in order]
    packet = hashlib.sha256(json.dumps([case, records, QUESTIONS], sort_keys=True).encode()).hexdigest()
    if a.out.exists():
        raise ValueError("Output directory already exists")
    with tempfile.TemporaryDirectory(dir=a.out.parent) as tmp:
        root = Path(tmp) / "run"
        packet_dir = root / "reviewer-1"
        packet_dir.mkdir(parents=True)
        (packet_dir / "case.txt").write_text(case + "\n", encoding="utf-8")
        (packet_dir / "instructions.txt").write_text("\n".join(f"{k}: {v}" for k,v in QUESTIONS.items()) +
            "\nWork independently. Answer yes, no, or insufficient evidence and explain each answer. "
            "For yes give the experiment and readout. For ultrasound yes also specify target tissue "
            "and evidence of an exposure limitation. Enter your reviewer identifier.\n", encoding="utf-8")
        write_csv(packet_dir / "evidence.csv", ["neutral_id", "name"] + EVIDENCE, records)
        write_csv(packet_dir / "review.csv", FIELDS, [dict(packet=packet, neutral_id=n) for n in labels.values()])
        shutil.copytree(packet_dir, root / "reviewer-2")
        key = dict(seed=a.seed, packet=packet, compounds={v:k for k,v in labels.items()},
                   lists={m:[labels[k] for k in ids] for m,ids in lists.items()})
        dump(root / "private-key.json", key)
        root.rename(a.out)


def read_reviews(path, key):
    reviews, reviewers = {}, set()
    for row in rows(path, FIELDS):
        n = row["neutral_id"]
        if row["packet"] != key["packet"] or n not in key["compounds"] or n in reviews:
            raise ValueError(f"{path}: invalid packet or neutral ID")
        reviews[n] = {}
        if row["reviewer"]:
            reviewers.add(row["reviewer"].casefold())
        for q in QUESTIONS:
            answer = row[q+"_answer"].lower()
            details = [row[q+"_"+f] for f in ("rationale","experiment","readout")]
            extra = [row["target_tissue"], row["exposure_evidence"]] if q=="ultrasound" else []
            if not answer and not any(details + extra):
                continue
            if (answer not in ("yes","no","insufficient evidence") or not details[0] or not row["reviewer"]
                    or (answer=="yes" and not all(details + extra))):
                raise ValueError(f"{path}: incomplete or invalid {q} judgment for {n}")
            reviews[n][q] = answer
    if len(reviewers)>1:
        raise ValueError(f"{path}: mixed reviewer identities")
    return reviews, reviewers


def score(a):
    key = json.loads(a.key.read_text())
    if a.first.samefile(a.second):
        raise ValueError("Supply two independent sheets")
    x, first = read_reviews(a.first,key)
    y, second = read_reviews(a.second,key)
    if first & second:
        raise ValueError("Reviewer identities must differ")
    methods = key["lists"]
    result = dict(methods={}, overlap={f"{i}/{j}": sorted(set(methods[i]) & set(methods[j]))
                  for i,j in itertools.combinations(METHODS,2)}, judgments={})
    for n in key["compounds"]:
        result["judgments"][n] = {q:[x.get(n,{}).get(q),y.get(n,{}).get(q)] for q in QUESTIONS}
    for m, ids in methods.items():
        metrics = result["methods"][m] = dict(returned=len(ids), slots=5)
        for q in QUESTIONS:
            pairs = {n: result["judgments"][n][q] for n in ids}
            complete = {n:p for n,p in pairs.items() if None not in p}
            agreements = sum(u==v for u,v in complete.values())
            metrics[q] = dict(endorsed_out_of_five=sum(p==["yes","yes"] for p in pairs.values()),
                insufficient_either=sum("insufficient evidence" in p for p in pairs.values()),
                insufficient_by_reviewer=[sum(p[i]=="insufficient evidence" for p in pairs.values()) for i in (0,1)],
                paired=len(complete), agreed=agreements, agreement=agreements/len(complete) if complete else None,
                disagreements=[n for n,p in complete.items() if p[0]!=p[1]],
                missing=[n for n,p in pairs.items() if None in p])
    dump(a.out,result)


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="command",required=True)
    for name, args in [("prepare","backend baseline pool evidence case out"),("score","key first second out")]:
        p=sub.add_parser(name)
        for arg in args.split():
            p.add_argument("--"+arg,type=Path,required=True)
        if name=="prepare":
            p.add_argument("--seed",type=int,required=True)
    a=parser.parse_args()
    try:
        (prepare if a.command=="prepare" else score)(a)
    except (ValueError,OSError) as e:
        parser.exit(2,f"{e}\n")


if __name__=="__main__":
    main()

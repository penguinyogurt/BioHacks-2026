"""Resolve affirmative chart text through released terminology into existing DRKG IDs."""
import csv
import gzip
import hashlib
import re
import subprocess
import xml.etree.ElementTree as ET
from collections import defaultdict
from tempfile import TemporaryDirectory
from pathlib import Path

VOCAB = {
    "desc2026.gz": ("https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.gz",
                    "ccd4d0d33bebfd4c836a59e7dd0c635b1d4e20c4f5a6abc55e2eb0ba4c8716dd"),
    "hetionet-nodes.tsv": ("https://raw.githubusercontent.com/hetio/hetionet/main/hetnet/tsv/hetionet-v1.0-nodes.tsv",
                           "3ad9eb86c031df8bc7d5efefa6edc93562182eb9a6a71e5129d3f18b9d42c50e"),
}
SYNONYMS = {"als": "amyotrophic lateral sclerosis", "pd": "parkinson disease",
            "ms": "multiple sclerosis"}
NEGATED = re.compile(r"\b(no|not|never|without|denies|denied|negative|family history|rule out|possible|stopped|discontinued|unknown)\b", re.I)


def norm(value):
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


class Terms:
    def __init__(self):
        self.lookup = defaultdict(lambda: defaultdict(set))
        self.labels = {}

    def add(self, kind, label, node):
        if norm(label):
            self.lookup[kind][norm(label)].add(node)

    def match(self, text, kind):
        # Avoid assigning observations with ambiguous polarity to a patient.
        if NEGATED.search(text):
            return []
        words = norm(text).split()
        matches = set()
        start = 0
        while start < len(words):
            for stop in range(len(words), start, -1):
                term = " ".join(words[start:stop])
                if term in SYNONYMS and kind == "disease":
                    term = SYNONYMS[term]
                ids = self.lookup[kind].get(term, ())
                if len(ids) == 1:
                    matches.update(ids)
                    start = stop
                    break
            else:
                start += 1
        return sorted(matches)

    def medication_parts(self, text):
        # Preserve unresolved co-medications so one known drug cannot clear a whole list.
        return [(part.strip(), self.match(part, "compound"))
                for part in re.split(r";|,|\n|\b(?:and|plus|but)\b", text, flags=re.I) if part.strip()]

    @classmethod
    def load(cls, root, graph, catalog, offline):
        for name, (url, sha) in VOCAB.items():
            path = root / name
            if not path.exists() and not offline:
                with TemporaryDirectory(dir=root) as tmp:
                    save = Path(tmp) / name
                    subprocess.run(["curl", "-fLsS", "--retry", "2", url, "-o", str(save)], check=True)
                    if hashlib.sha256(save.read_bytes()).hexdigest() != sha:
                        raise ValueError("Vocabulary checksum mismatch: " + name)
                    save.replace(path)
            if hashlib.sha256(path.read_bytes()).hexdigest() != sha:
                raise ValueError("Vocabulary checksum mismatch: " + name)
        terms = cls()
        with (root / "hetionet-nodes.tsv").open() as f:
            for row in csv.DictReader(f, delimiter="\t"):
                node = row["id"]
                if node in graph.entities:
                    terms.labels[node] = row["name"]
                    if row["kind"] != "Disease":  # Use the MeSH namespace for clinical diagnoses.
                        terms.add(row["kind"].lower(), row["name"], node)
        with gzip.open(root / "desc2026.gz") as f:
            for _, record in ET.iterparse(f, events=("end",)):
                if record.tag != "DescriptorRecord":
                    continue
                ui = record.findtext("DescriptorUI")
                node = "Disease::MESH:" + ui
                if node in graph.entities:
                    terms.labels[node] = record.findtext("DescriptorName/String")
                    terms.add("disease", terms.labels[node], node)
                    for term in record.findall("ConceptList/Concept/TermList/Term/String"):
                        terms.add("disease", term.text, node)
                record.clear()
        for item in catalog["ingredients"]:
            node = item["id"]
            if node in graph.entities:
                terms.labels[node] = item["name"]
                for name in [item["name"], *item["aliases"]]:
                    terms.add("compound", name, node)
        return terms

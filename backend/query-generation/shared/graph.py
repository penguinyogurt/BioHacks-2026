"""Typed, read-only snapshot of the official TransE-L2 release."""
from functools import lru_cache
import csv
import hashlib
import json
import subprocess
import tarfile
import shutil
from array import array
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np

URL = "https://dgl-data.s3-us-west-2.amazonaws.com/dataset/DRKG/drkg.tar.gz"
SHA = "00a8154a35bda496d0fdfe0d76b058bf4bd3dd11f69d0ec00c3559523608b930"
FILES = ["drkg.tsv","relation_glossary.tsv","embed/entities.tsv","embed/relations.tsv",
         "embed/DRKG_TransE_l2_entity.npy","embed/DRKG_TransE_l2_relation.npy"]


def download(root):
    if all((root/f).is_file() for f in FILES):
        return
    root.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(dir=root) as work:
        work=Path(work)
        archive=work/"archive"
        subprocess.run(["curl","-fLsS","--retry","2",URL,"-o",str(archive)],check=True)
        digest=hashlib.sha256()
        with archive.open("rb") as f:
            for chunk in iter(lambda:f.read(1<<20),b""): digest.update(chunk)
        if digest.hexdigest()!=SHA: raise ValueError("DRKG archive checksum mismatch")
        with tarfile.open(archive) as tar:
            members={m.name.removeprefix("./"):m for m in tar if m.isfile()}
            for name in FILES:
                dest=work/name
                dest.parent.mkdir(exist_ok=True)
                with dest.open("wb") as f: shutil.copyfileobj(tar.extractfile(members[name]),f)
        for name in FILES:
            (root/name).parent.mkdir(exist_ok=True)
            (work/name).replace(root/name)


def mapping(path):
    result={}
    with path.open() as f:
        for name,idx in csv.reader(f,delimiter="\t"):
            if name in result: raise ValueError(f"Duplicate identifier in {path}")
            result[name]=int(idx)
    if sorted(result.values())!=list(range(len(result))): raise ValueError(f"Invalid row mapping in {path}")
    return result


class Graph:
    def __init__(self, root):
        manifest=json.loads(Path(__file__).with_name("release.json").read_text())
        for name,expected in manifest.items():
            digest=hashlib.sha256()
            with (root/name).open("rb") as f:
                for chunk in iter(lambda:f.read(1<<20),b""): digest.update(chunk)
            if digest.hexdigest()!=expected: raise ValueError(f"Frozen DRKG file checksum mismatch: {name}")
        self.entities=mapping(root/FILES[2])
        self.relations=mapping(root/FILES[3])
        self.names=sorted(self.entities,key=self.entities.get)
        self.E,self.R=[np.load(root/f,mmap_mode="r",allow_pickle=False) for f in FILES[4:]]
        if self.E.shape!=(len(self.entities),400) or self.R.shape!=(len(self.relations),400):
            raise ValueError("Index and pretrained matrix shapes disagree")
        if not all(np.isfinite(m).all() for m in (self.E,self.R)): raise ValueError("Nonfinite embedding")
        with (root/FILES[1]).open() as f:
            self.gloss={r["Relation-name"]:r for r in csv.DictReader(f,delimiter="\t")}
        if self.relations.keys()!=self.gloss.keys(): raise ValueError("Incomplete relation glossary")
        self.types={}; buffers={r:array("i") for r in self.relations}
        for r,g in self.gloss.items():
            pair=tuple(r.split(":")[-2:])
            gloss=g["Connected entity-types"].replace("ATC","Atc").replace("Diisease","Disease")
            if sorted(pair)!=sorted(gloss.split(":")): raise ValueError(f"Glossary type mismatch: {r}")
            self.types[r]=pair
        # Validate actual ordered triples against relation suffix; glossary pair order
        # is descriptive and frequently reversed. Never auto-reverse a bad edge.
        types=[n.partition("::")[0] for n in self.names]
        self.quarantined={}
        self.triples=0
        with (root/FILES[0]).open() as f:
            for line in f:
                h,r,t=line.rstrip("\r\n").split("\t")
                i,j=self.entities[h],self.entities[t]
                self.triples+=1
                if (types[i],types[j])!=self.types[r]:
                    self.quarantined[r]=self.quarantined.get(r,0)+1
                    continue
                buffers[r].extend((i,j))
        self.edges={r:np.frombuffer(v,dtype=np.int32).reshape(-1,2) for r,v in buffers.items()}
        for v in self.edges.values(): v.flags.writeable=False

    @lru_cache(maxsize=4096)
    def walk(self,node,relation,forward):
        if node not in self.entities or relation not in self.edges: return []
        source,dest=(0,1) if forward else (1,0)
        if node.split("::")[0]!=self.types[relation][source]: raise ValueError(f"Invalid step {node} {relation}")
        pairs=self.edges[relation]
        return [self.names[i] for i in pairs[pairs[:,source]==self.entities[node],dest]]

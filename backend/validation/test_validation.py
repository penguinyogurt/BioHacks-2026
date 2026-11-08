import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import validate as v

FIX = Path(__file__).resolve().parent / "synthetic"


class ValidationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.args = SimpleNamespace(**{k: FIX/(k+".csv") for k in ("backend","baseline","pool","evidence")},
                                    case=FIX/"case.txt",seed=42,out=self.root/"a")

    def prep(self):
        v.prepare(self.args)
        return json.loads((self.args.out/"private-key.json").read_text())

    def test_packets_overlap_and_replay(self):
        key = self.prep()
        a = self.args.out
        self.args.out = self.root/"b"
        self.assertEqual(key,self.prep())
        self.assertEqual(len(set(key["lists"]["random"])),5)
        self.assertEqual(len(set(key["lists"]["backend"]) & set(key["lists"]["baseline"])),1)
        packet = a/"reviewer-1"
        self.assertEqual({p.name for p in packet.iterdir()},{"case.txt","review.csv","instructions.txt","evidence.csv"})
        for p in packet.iterdir():
            self.assertEqual(p.read_bytes(),(a/"reviewer-2"/p.name).read_bytes())
            for secret in ("Compound::","backend","baseline","graph score","random control"):
                self.assertNotIn(secret,p.read_text())
        self.assertEqual(len(v.rows(packet/"review.csv",v.FIELDS)),len(set(sum(key["lists"].values(),[]))))
        self.assertFalse((a/"result.json").exists())

    def test_empty_and_short_pool(self):
        empty=self.root/"empty.csv"
        v.write_csv(empty,[v.ID],[])
        self.args.backend=self.args.baseline=empty
        pool=self.root/"pool.csv"
        v.write_csv(pool,[v.ID,"name"],v.rows(self.args.pool,[v.ID,"name"])[:2])
        self.args.pool=pool
        key=self.prep()
        self.assertEqual([len(key["lists"][m]) for m in v.METHODS],[0,0,2])

    def test_scoring(self):
        self.prep()
        a=SimpleNamespace(key=self.args.out/"private-key.json",first=FIX/"review-1.csv",
                          second=FIX/"review-2.csv",out=self.root/"score.json")
        v.score(a)
        r=json.loads(a.out.read_text())
        self.assertEqual(r["judgments"]["R03"]["als"],["insufficient evidence",None])
        for method,ids in json.loads(a.key.read_text())["lists"].items():
            for q in v.QUESTIONS:
                stats=r["methods"][method][q]
                self.assertEqual(stats["endorsed_out_of_five"],sum(r["judgments"][n][q]==["yes","yes"] for n in ids))
                self.assertEqual("R03" in stats["missing"],"R03" in ids)
        a.second=a.first
        with self.assertRaises(ValueError):
            v.score(a)

_T = "C[C@H]1O[C@H](n2cc(C)c(=O)[nH]c2=O)C[C@H]1O"
ASO_20MER = "O" + _T + ("P(=S)(O)O" + _T) * 19

PRESETS = [
    {"name": "Riluzole", "smiles": "Nc1nc2ccc(OC(F)(F)F)cc2s1", "role": "positive", "note": "Alex's current oral therapy."},
    {"name": "Edaravone", "smiles": "CC1=NN(C(=O)C1)c1ccccc1", "role": "positive", "note": "Other approved ALS drug; zero H-bond donors."},
    {"name": "Caffeine", "smiles": "CN1C=NC2=C1C(=O)N(C)C(=O)N2C", "role": "positive", "note": "Universal positive control."},
    {"name": "Sucrose", "smiles": "OCC1OC(OC2(CO)OC(CO)C(O)C2O)C(O)C(O)C1O", "role": "negative", "note": "TPSA 190; kills rule-based heuristics."},
    {"name": "ASO 20-mer (surrogate)", "smiles": ASO_20MER, "role": "refusal", "surrogate": True, "note": "Tofersen-scale phosphorothioate; model refuses."},
    {"name": "Tofersen (real)", "smiles": None, "role": "refusal", "kind": "no_structure", "formula": "C230H317N72O123P19S15", "mw": 7127.86, "note": "7,128 Da; no SMILES; refused by rule."},
    {"name": "Loperamide", "smiles": "CN(C)C(=O)C(CCN1CCC(O)(c2ccc(Cl)cc2)CC1)(c1ccccc1)c1ccccc1", "role": "failure", "note": "P-gp efflux; where we are wrong."},
    {"name": "Lithium carbonate", "smiles": "[Li+].[Li+].[O-]C(=O)[O-]", "role": "refusal", "note": "Inorganic salt; outside organic training set."},
]

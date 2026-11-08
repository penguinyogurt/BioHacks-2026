"""Patient-constrained drug repurposing for ALS.

Four independent modules, each writing one JSON file to ``data/``. Integration is
through files, not imports, so a broken module never blocks the others.

    src.kg_rank        -> data/kg_scores.json
    src.bbb_model      -> data/bbb_scores.json
    src.patient_filter -> data/patient_filter.json
    src.merge          -> data/pipeline.json   (the only file app/ reads)
"""

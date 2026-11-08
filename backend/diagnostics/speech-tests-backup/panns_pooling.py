"""Paired speaker-level experiment on pre-pooling CNN6 features."""
import csv
import json
import os

import numpy as np
import torch
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import StratifiedShuffleSplit
from torch import nn
from torch.nn import functional as F
from torch.nn.utils.rnn import pad_sequence

from panns_sequences import OUT, load_sequences, reference
from speech_severity import PRIVATE, TASKS, read_ratings

SEED = 42
MAX_EPOCHS = 50
PATIENCE = 7
BATCH = 12


class OrdinalHead(nn.Module):
    def __init__(self, attention):
        super().__init__()
        self.score = nn.Linear(512*len(TASKS),1)
        self.gaps = nn.Parameter(torch.zeros(2))
        self.attention = nn.Linear(512,1,bias=False) if attention else None
        if attention:
            nn.init.zeros_(self.attention.weight)

    def forward(self,x,valid):
        # Shape: flattened (speaker,task), time, channel. Pad only after CNN inference.
        if self.attention is None:
            weights = valid / valid.sum(1,keepdim=True)
        else:
            logits = self.attention(x).squeeze(-1).masked_fill(~valid,-torch.inf)
            weights = logits.softmax(1)
        pooled = torch.bmm(weights.unsqueeze(1),x).squeeze(1)
        pooled = F.layer_norm(pooled,(512,)).reshape(-1,512*len(TASKS))
        gaps = F.softplus(self.gaps)
        thresholds = torch.stack((-gaps[0],gaps.new_zeros(()),gaps[1]))
        return self.score(pooled)-thresholds


def batch(sequences, indices):
    tasks = [s for i in indices for s in sequences[i]]
    x = pad_sequence(tasks,batch_first=True)
    valid = torch.arange(x.size(1))[None,:] < torch.tensor([len(s) for s in tasks])[:,None]
    return x,valid


def train(sequences,y,fit,assess,attention,seed,n_epochs,select):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = OrdinalHead(attention)
    opt = torch.optim.AdamW(model.parameters(),lr=0.0003,weight_decay=0.01)
    targets = (torch.tensor(y)[:,None] > torch.arange(1,4)).float()
    best_loss, best_epoch = np.inf, 0
    for epoch in range(1,n_epochs+1):
        order = rng.permutation(fit)
        for ix in np.array_split(order,int(np.ceil(len(order)/BATCH))):
            opt.zero_grad()
            logits = model(*batch(sequences,ix))
            F.binary_cross_entropy_with_logits(logits,targets[ix]).backward()
            opt.step()
        if select:
            with torch.no_grad():
                logits = infer(model,sequences,assess)
                loss = F.binary_cross_entropy_with_logits(logits,targets[assess]).item()
            if loss < best_loss-1e-5:
                best_loss,best_epoch = loss,epoch
            if epoch-best_epoch >= PATIENCE:
                break
    if select:
        return best_epoch
    return (1+(infer(model,sequences,assess)>0).sum(1)).numpy()


@torch.no_grad()
def infer(model,sequences,indices):
    return torch.cat([model(*batch(sequences,indices[i:i+BATCH])) for i in range(0,len(indices),BATCH)])


def save_csv(path,header,rows):
    with path.open("w",newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def main():
    os.umask(0o077)
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    rows = reference()
    ids = np.array([r["speaker"] for r in rows])
    y = np.array([int(r["observed_rating"]) for r in rows])
    folds = np.array([int(r["fold"]) for r in rows])
    baseline = np.array([int(r["ordinal_prediction"]) for r in rows])
    metadata = read_ratings(PRIVATE/"data"/"VOC-ALS.xlsx")
    assert len(set(ids))==len(ids)==102 and (baseline==y).sum()==67
    assert all(metadata[s]==v for s,v in zip(ids,y)) and set(folds)==set(range(1,6))
    sequences = load_sequences(rows)
    # Both initial pooling rules must agree, including with extra padding.
    torch.manual_seed(SEED)
    mean = OrdinalHead(False)
    torch.manual_seed(SEED)
    attention = OrdinalHead(True)
    x,mask = batch(sequences,[0,1])
    with torch.no_grad():
        for m in (mean,attention):
            torch.testing.assert_close(mean(x,mask),m(F.pad(x,(0,0,0,3),value=12),F.pad(mask,(0,3))))
    predictions = {"HuBERT":baseline,"PANNs_mean":np.zeros_like(y),"PANNs_attention":np.zeros_like(y)}
    audit = []
    for k in sorted(set(folds)):
        outer, test = np.flatnonzero(folds!=k), np.flatnonzero(folds==k)
        split = StratifiedShuffleSplit(n_splits=1,test_size=0.25,random_state=SEED+k)
        a,b = next(split.split(outer,y[outer]))
        fit,dev = outer[a],outer[b]
        groups = [set(ids[ix]) for ix in (fit,dev,test)]
        assert all(groups[i].isdisjoint(groups[j]) for i,j in [(0,1),(0,2),(1,2)])
        assert set(outer)==set(fit)|set(dev)
        for name,use_attention in [("PANNs_mean",False),("PANNs_attention",True)]:
            epoch = train(sequences,y,fit,dev,use_attention,SEED+k,MAX_EPOCHS,True)
            predictions[name][test] = train(sequences,y,outer,test,use_attention,SEED+k,epoch,False)
            audit.append(dict(fold=int(k),model=name,epochs=epoch,inner_dev=ids[dev].tolist()))
            print(k,name,"epochs",epoch,flush=True)
    header = ["speaker","fold","observed",*predictions]
    records = list(zip(ids,folds,y,*predictions.values()))
    save_csv(OUT/"predictions.csv",header,records)
    save_csv(OUT/"changed_predictions.csv",header,[r for r in records if len(set(r[3:]))>1])
    summary, matrices = [],[]
    for name,p in predictions.items():
        cm = confusion_matrix(y,p,labels=[1,2,3,4])
        recalls = cm.diagonal()/cm.sum(axis=1)
        summary.append([name,np.mean(p==y),np.mean(abs(p-y)),recalls.mean(),cm[2,3],
                        *recalls,*cm.sum(axis=1)])
        matrices.extend([name,i,*r] for i,r in enumerate(cm,1))
    save_csv(OUT/"comparison.csv",["model","accuracy","MAE","macro_recall","mild_to_normal",
             *[f"recall_{i}" for i in range(1,5)],*[f"count_{i}" for i in range(1,5)]],summary)
    save_csv(OUT/"confusion.csv",["model","actual","severe","moderate","mild","normal"],matrices)
    (OUT/"splits.json").write_text(json.dumps(audit,indent=2))
    pooled_pairs = []
    for first,second in [("HuBERT","PANNs_mean"),("HuBERT","PANNs_attention"),("PANNs_mean","PANNs_attention")]:
        a,b = predictions[first],predictions[second]
        changed = a!=b
        improved = (a!=y)&(b==y)
        worsened = (a==y)&(b!=y)
        pooled_pairs.append([first,second,int(changed.sum()),int(improved.sum()),
                             int(worsened.sum()),int((changed & (a!=y) & (b!=y)).sum())])
    save_csv(OUT/"paired_changes.csv",["from","to","changed","newly_correct",
             "formerly_correct","different_but_both_wrong"],pooled_pairs)
    print((OUT/"comparison.csv").read_text())


if __name__=="__main__":
    main()

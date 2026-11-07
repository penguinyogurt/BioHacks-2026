# PANNs temporal pooling on VOC-ALS

Run in the existing Speech_Quality_Classification environment with the original downloaded WAVs, metadata, and HuBERT predictions available. The published [PANNs checkpoint](https://zenodo.org/records/3987831) is AudioSet CNN6. The extractor follows the [authors’ CNN6 architecture](https://github.com/qiuqiangkong/audioset_tagging_cnn/blob/master/pytorch/models.py). All data, checkpoints, caches and speaker-level outputs stay under the ignored private directory.

On a fresh copy, fetch the checkpoint once:

```sh
cd ~/Documents/BioHacks/Speech_Quality_Classification
mkdir -p private/panns
curl -fL --retry 2 'https://zenodo.org/records/3987831/files/Cnn6_mAP%3D0.343.pth?download=1' -o private/panns/cnn6.pth
```

To reproduce with the existing checkpoint:

```sh
cd ~/Documents/BioHacks/Speech_Quality_Classification
.venv/bin/python -B panns_sequences.py && .venv/bin/python -B panns_pooling.py
```

**Features.** Mono float audio is resampled to 32 kHz. The checkpoint supplies the actual 1,024-sample Hann STFT kernels and 64 mel filters (50 Hz to 14 kHz). The hop is 320 samples, with centered reflection padding, power spectrogram, 10 log10 mel power, and a 1e-10 floor. Inference uses stored batch-normalization statistics and four frozen convolution/average-pooling blocks. Averaging block four over frequency gives a variable-length sequence of 512-vectors at roughly 160 ms intervals. Each unpadded recording gets a content-addressed float32 cache entry. Feature extraction can use the Mac GPU. Head training uses CPU.

**Paired design.** Both heads use A, E, I, O, U, PA, TA, KA task order. Padding is introduced only after CNN inference and explicitly masked. Head A averages valid frames. Head B learns one shared linear attention score and applies a masked softmax across the frames of each task. Its zero-initialized scorer starts uniform. Each head applies identical per-task layer normalization and concatenates the eight outputs. A shared-form speaker score and three ordered cutpoints model ratings greater than 1, 2 and 3 using unweighted binary cross-entropy. The predicted rating is one plus the number of positive threshold logits. Only audio enters the heads.

The manifest private/results/predictions.csv supplies the original outer folds and reference predictions. Within each outer training set both heads use the same 25% stratified speaker split, seed 42 + fold, initialization for shared parameters, minibatch order, AdamW (learning rate 0.0003, weight decay 0.01), maximum 50 epochs, and validation-loss patience of seven. Each head selects its epoch on the inner split and refits from scratch on all outer training speakers. The code checks disjoint speaker sets, uniform-attention equivalence, and padding invariance. There is one outer prediction per speaker per head.

**Outputs.** private/panns/comparison.csv contains aggregate metrics. confusion.csv has observed rows and predicted columns, in severe-to-normal order. predictions.csv lists all paired predictions and changed_predictions.csv lists speakers for whom any predictions differ. splits.json records inner validation IDs and selected epochs per fold. The saved HuBERT baseline uses different features and training procedures; the direct mean–attention comparison isolates temporal pooling.

## Observed results

Across the 102 held-out speakers, both PANNs heads gave identical discrete ratings. Each correctly rated 54/102 (52.9%), with MAE 0.529 levels and macro recall 41.2%. HuBERT correctly rated 67/102 (65.7%), with MAE 0.363 and macro recall 46.3%. The heads chose the same epoch in each fold (8, 23, 5, 32, 18). The ordinal decisions alone do not establish that the learned attention weights were uniform.

Each CNN head correctly rated 3/5 severe, 1/13 moderate, 2/31 mild and 48/53 normal speakers. HuBERT correctly rated 0/5, 6/13, 18/31 and 43/53, respectively. Mild-to-normal errors rose from 12 to 29. Compared with HuBERT, each head changed 40 predictions: 10 became correct, 23 became incorrect, and seven changed between two incorrect ratings. All 40 rows are in private/panns/changed_predictions.csv. With only five severe speakers, each one represents 20 percentage points of severe recall.

There were 816 task recordings and 815 distinct WAV hashes. Two speaker IDs share a byte-identical /a/ recording. They belonged to the same outer fold, and the shared file did not cross any inner fit/validation split in this run. Both labeled speaker rows were retained to preserve the requested baseline comparison.

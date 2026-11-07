# VOC-ALS speech severity

Run from this directory with Python 3.9–3.11 and access to [VOC-ALS](https://doi.org/10.7303/syn53009474). Sign in to Synapse and verify that Download works on [VOC-ALS.xlsx](https://www.synapse.org/Synapse:syn53182546). In [Synapse personal access tokens](https://www.synapse.org/PersonalAccessTokens:), create a token with **View** and **Download** scopes. In zsh, enter it privately with `read -rs 'SYNAPSE_AUTH_TOKEN?Synapse token: '; export SYNAPSE_AUTH_TOKEN`. Existing Synapse client credentials also work.

Install once with `python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`. Reproduce with:

```sh
cd ~/Documents/BioHacks/Speech_Quality_Classification && .venv/bin/python speech_severity.py
```

The experiment selects ALS speakers with speech scores 1 (severe), 2 (moderate), 3 (mild), or 4 (normal). It reports counts before and after checking for a complete set of recordings. Each speaker contributes eight 768-value vectors in A, E, I, O, U, PA, TA, KA order. Each vector is the time average of frozen HuBERT final-layer states for one mono, 16 kHz recording. Clinical metadata supplies eligibility and targets only.

Cross-validation stratifies speaker rows with seed 42 and uses the smaller of five folds and the smallest class count. Every fold fits its own standardization, up to ten whitened PCs, and L2-regularized all-threshold ordinal logistic regression (alpha 1). The baseline predicts the lower median training rating. Held-out predictions and metrics for both methods are written under `private/results/`; confusion matrices use ratings 1–4 on both axes. Downloads, embedding caches, and results are ignored by Git.

`passage_wpm(words_spoken, elapsed_seconds)` computes reading rate for a completed passage, including pauses in elapsed time. The VOC-ALS evaluation uses only the vowel and syllable tasks.

## Compare models on the saved speaker folds

Run `.venv/bin/python speech_severity.py --compare` from this directory after the original experiment. This reads the local workbook, WAVs, content-addressed HuBERT cache and saved folds. It reruns the reference and checks every prediction and fold before comparing models. Outputs in `private/comparison/` include the side-by-side metrics, confusion matrices (rows observed, columns predicted), speaker predictions, and hyperparameters chosen in each outer fold.

The alternatives use four stratified inner folds and maximize pooled inner macro recall. Scaling, median imputation, PCA, and class frequencies use training speakers only. HuBERT uses five or ten whitened PCs. The acoustic model uses 30 features: active-span duration, fraction active and amplitude variability for each task, plus estimated syllable peaks per second and interpeak timing variability for each repetition task. Syllable counts are envelope-based estimates. Combined models append the scaled acoustics to the HuBERT PCs. Each alternative tunes ordinal L2 regularization (1 or 10). Weighted HuBERT tests inverse-frequency exponents 0.5 and 1; acoustic and combined models also allow zero. An extra tuned unweighted HuBERT control helps interpret the effect of weighting. The default invocation retains the original model.

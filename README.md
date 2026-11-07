# ALS-associated biceps EMG patterns

`SVD_ALS_prediction.py` reproduces a patient-level comparison of ALS and healthy participants using long-head biceps recordings from Miki Nikolic’s [EMGLAB N2001 dataset](https://www.emglab.net/emglab/Signals/N2001/index.html).

## Run

Download the [biceps ZIP archive](https://www.kaggle.com/datasets/lydialoubar/emglab) and save it beside the script as `biceps.zip`, keeping it compressed. From this directory, run:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install numpy scipy matplotlib scikit-learn
python SVD_ALS_prediction.py
```

The script checks patient IDs and header metadata, then takes each patient's median recording values for RMS amplitude, 99th–1st percentile amplitude span, waveform length per second, and median frequency. It saves patient features and held-out predictions in `patients.csv`, with the full-cohort SVD in `patient-scores.png` and `component-weights.png`.

## Results

Across 6 ALS and 9 healthy participants, logistic regression on two components and on all four features each achieved 83.3% balanced accuracy. Both correctly classified four ALS participants and all nine controls. Scaling and the two-component SVD were refitted inside each leave-one-patient-out fold. These findings describe ALS-associated patterns within this cohort.

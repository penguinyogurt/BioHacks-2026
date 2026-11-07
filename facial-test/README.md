# Expression challenge

On this Mac, run setup once:

```sh
cd ~/Documents/BioHacks/facial-test && ./setup.sh
```

Launch the loopback server and open the browser:

```sh
cd ~/Documents/BioHacks/facial-test && .venv/bin/python app.py
```

The four challenges are Happy, Sad, Disgusted, and Neutral. After Neutral, the summary counts the latest scored attempt for each expression. A retake for face count adds no failure. Start new challenge resets the total.

Start camera requests video permission. Ready starts a three-second preparation countdown followed by three seconds to hold the expression. The app freezes one mirrored frame, sends the displayed canvas as lossless PNG to localhost, and keeps the result visible. The detector checks the whole photo before the classifier runs. Detection of zero or multiple faces requires a retake. Stop releases tracks and invalidates timers and outstanding responses. A round interrupted by a hidden tab returns to the prompt. Threshold changes apply to the next round.

## Model and input

Setup pins [the official source](https://github.com/Talented-Q/POSTER_V2/tree/18de5591c3fa0b7b22bb9fe2d61e7f813e6e3b08), fetches the authors’ RAF-DB checkpoint, and checks SHA-256 before converting it with PyTorch restricted loading. Its recorded best accuracy is 92.2099%. The runtime copy skips only two training initialization loads that point to Windows paths. All 747 fine-tuned state entries load strictly. POSTER++ runs in evaluation mode once per server process and scores each single-face photo under inference mode. Device priority is CUDA, Apple MPS, then CPU. Use `app.py --cpu` when starting a fresh server to force CPU.

The [official validation loader](https://github.com/Talented-Q/POSTER_V2/blob/18de5591c3fa0b7b22bb9fe2d61e7f813e6e3b08/main.py#L135-L139) reads pre-aligned RGB images, resizes to 224×224 using PIL bilinear interpolation, converts to tensors and applies ImageNet mean/std. These steps are reused. The repo does not supply a raw-webcam alignment routine. For webcam input, OpenCV YuNet finds two eyes, the nose, and both mouth corners. A least-squares affine warp maps them to a 100×100 face crop. The target coordinates in inference.py are the median YuNet landmark positions measured on 81 single-face detections from the validation sample below. This approximates the released RAF crop geometry; exact equivalence to the dataset's original landmark registration is unverified.

The checkpoint stores numeric logits. Verified output indices 0–6 are Surprised, Fearful, Disgusted, Happy, Sad, Angry, Neutral. Using the first 12 aligned test images per RAF numeric class from the [RAF-DB test mirror](https://huggingface.co/datasets/elipaluma/RAF-DB_Kaggle), the modal predicted index was 0, 1, 2, 3, 4, 5, 6 respectively. Correct-index counts were 10, 7, 9, 12, 11, 11, 12 of 12. This was a label-order check, not a new benchmark. Confidence displayed is the requested label's softmax probability; threshold comparisons use the unrounded number.

## Verification

CPU and the accelerated local server scored the public [scikit-image astronaut photo](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/astronaut.png) as Happy (99.992%). A blank produced zero detections; two side-by-side portraits produced two. Browser integration checks used a synthetic video stream and a controlled browser clock with the real inference endpoint: both countdowns, no request before six seconds, exactly one canvas capture at 6000 ms, display-to-server PNG hash equality, wrong-label FAIL, retake, frozen result, and Stop during countdown and pending inference.

To repeat the browser checks, keep the server running, install Playwright in a test environment, put the public test image at `assets/smoke.png`, and run `python check_round.py` from this directory with Google Chrome installed. The app saves no webcam photos. Assets, virtual environment, and caches are Git-ignored.

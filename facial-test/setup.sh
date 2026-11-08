#!/bin/bash
set -eu
cd "$(dirname "$0")"
python3 -m venv --system-site-packages .venv
.venv/bin/python -m pip install 'torch==2.7.1' 'torchvision==0.22.1' 'timm==0.6.13' 'thop==0.1.1.post2209072238' 'opencv-python-headless==4.10.0.84' 'numpy<2.1'
mkdir -p assets
src=assets/POSTER_V2
if [ ! -d "$src/.git" ]; then git clone https://github.com/Talented-Q/POSTER_V2 "$src"; fi
git -C "$src" checkout --quiet 18de5591c3fa0b7b22bb9fe2d61e7f813e6e3b08
fetch() {
 if ! [ -f "$2" ] || ! echo "$3  $2" | shasum -a 256 -c - >/dev/null; then
  curl -fL --retry 2 "$1" -o "$2.part"
  echo "$3  $2.part" | shasum -a 256 -c -
  mv "$2.part" "$2"
 fi
}
fetch 'https://drive.usercontent.google.com/download?id=1aVm_hmJyZ5E_0p25XTbm3X9ophsKqCxv&export=download&confirm=t' assets/raf.pt d9bf1d0d88238966ce0d1a289a2bb5f927ec2fe635ef1ec4396c323028924701
fetch 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' assets/yunet.onnx 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
.venv/bin/python prepare.py

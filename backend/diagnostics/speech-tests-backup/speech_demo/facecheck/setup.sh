#!/bin/bash
set -eu
cd "$(dirname "$0")/../.."
mkdir -p private/facecheck
cd private
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fLsS --retry 2 https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz -o "$tmp/vision.tgz"
curl -fLsS --retry 2 https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task -o "$tmp/model.task"
echo "84597a25e13d123b5f4cbe768bb72e97a2c28c7a465f0ace287d8cbe5246bff0  $tmp/vision.tgz" | shasum -a 256 -c -
echo "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  $tmp/model.task" | shasum -a 256 -c -
tar -xzf "$tmp/vision.tgz" -C facecheck --strip-components 1 package/vision_bundle.mjs package/wasm
mv "$tmp/model.task" facecheck/face_landmarker.task

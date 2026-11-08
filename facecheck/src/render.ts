import { DrawingUtils, FaceLandmarker } from "@mediapipe/tasks-vision";
import { detect } from "./landmarker";
import type { BlendshapeVector } from "./protocol";

let recordBuffer: BlendshapeVector[] | null = null;
let started = false;
let lastFaceSeenAt = 0;
let meshVisible = true;

/** Start buffering blendshape samples from the shared detect loop. */
export function startRecording(): void {
  recordBuffer = [];
}

/** Stop buffering and return everything collected since startRecording(). */
export function stopRecording(): BlendshapeVector[] {
  const buf = recordBuffer ?? [];
  recordBuffer = null;
  return buf;
}

export function faceCurrentlyVisible(): boolean {
  return performance.now() - lastFaceSeenAt < 500;
}

export function setMeshVisible(visible: boolean): void {
  meshVisible = visible;
}

/** One continuous detect+draw loop shared by the live mesh overlay and expression capture. */
export function startRenderLoop(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  if (started) return;
  started = true;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const drawingUtils = new DrawingUtils(ctx);

  const tick = () => {
    requestAnimationFrame(tick);
    if (video.readyState < 2) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const { landmarks, blendshapes } = detect(video, performance.now());

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks) {
      lastFaceSeenAt = performance.now();
      // Just the face/eye/brow/lip outlines, not the full 478-point triangulated
      // mesh -- that covered too much of the face to read expressions behind it.
      if (meshVisible) {
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, {
          color: "rgba(255, 255, 255, 0.55)",
          lineWidth: 1,
        });
      }
    }

    if (recordBuffer && blendshapes) recordBuffer.push(blendshapes);
  };
  requestAnimationFrame(tick);
}

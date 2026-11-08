import { DrawingUtils, FaceLandmarker } from "@mediapipe/tasks-vision";
import { detect } from "./landmarker";
import type { BlendshapeVector } from "./protocol";

let recordBuffer: BlendshapeVector[] | null = null;
let started = false;
let lastFaceSeenAt = 0;

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
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
        color: "rgba(111, 211, 160, 0.25)",
        lineWidth: 1,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, {
        color: "#6fd3a0",
        lineWidth: 1.5,
      });
    }

    if (recordBuffer && blendshapes) recordBuffer.push(blendshapes);
  };
  requestAnimationFrame(tick);
}

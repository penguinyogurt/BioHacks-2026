import { DrawingUtils, FaceLandmarker } from "./assets/vision_bundle.mjs";
import { detect } from "./landmarker.js";
let recordBuffer = null;
let started = false;
let lastFaceSeenAt = 0;
let meshVisible = true;
export function startRecording() {
    recordBuffer = [];
}
export function stopRecording() {
    const buf = recordBuffer ?? [];
    recordBuffer = null;
    return buf;
}
export function faceCurrentlyVisible() {
    return performance.now() - lastFaceSeenAt < 500;
}
export function setMeshVisible(visible) {
    meshVisible = visible;
}
export function startRenderLoop(video, canvas) {
    if (started) return;
    started = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const drawingUtils = new DrawingUtils(ctx);
    const tick = ()=>{
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
            if (meshVisible) {
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, {
                    color: "rgba(255, 255, 255, 0.55)",
                    lineWidth: 1
                });
            }
        }
        if (recordBuffer && blendshapes) recordBuffer.push(blendshapes);
    };
    requestAnimationFrame(tick);
}

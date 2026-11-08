import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { BlendshapeVector } from "./protocol";

// Keep this in lockstep with the installed @mediapipe/tasks-vision version
// (package.json pins it exactly) — the WASM runtime and the JS API glue
// code have to match, or createFromOptions fails with a non-Error object.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarker: FaceLandmarker | null = null;

export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
  return landmarker;
}

export type DetectionResult = {
  landmarks: NormalizedLandmark[] | null;
  blendshapes: BlendshapeVector | null;
};

/** Runs detection for the current video frame; returns landmarks and blendshapes if a face was found. */
export function detect(video: HTMLVideoElement, timestampMs: number): DetectionResult {
  if (!landmarker) return { landmarks: null, blendshapes: null };
  const result: FaceLandmarkerResult = landmarker.detectForVideo(video, timestampMs);
  const landmarks = result.faceLandmarks?.[0] ?? null;
  const categories = result.faceBlendshapes?.[0]?.categories;
  const blendshapes = categories
    ? Object.fromEntries(categories.map((c) => [c.categoryName, c.score]))
    : null;
  return { landmarks, blendshapes };
}

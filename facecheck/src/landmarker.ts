import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { BlendshapeVector } from "./protocol";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";
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

/** Runs detection for the current video frame and returns the blendshape vector, if a face was found. */
export function detectBlendshapes(
  video: HTMLVideoElement,
  timestampMs: number,
): BlendshapeVector | null {
  if (!landmarker) return null;
  const result: FaceLandmarkerResult = landmarker.detectForVideo(video, timestampMs);
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories || categories.length === 0) return null;
  const vector: BlendshapeVector = {};
  for (const c of categories) vector[c.categoryName] = c.score;
  return vector;
}

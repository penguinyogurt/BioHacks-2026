import { FaceLandmarker, FilesetResolver } from "./assets/vision_bundle.mjs";
const WASM_BASE = "/facecheck/assets/wasm";
const MODEL_URL = "/facecheck/assets/face_landmarker.task";
let landmarker = null;
export async function loadFaceLandmarker() {
    if (landmarker) return landmarker;
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false
    });
    return landmarker;
}
export function detect(video, timestampMs) {
    if (!landmarker) return {
        landmarks: null,
        blendshapes: null
    };
    const result = landmarker.detectForVideo(video, timestampMs);
    const landmarks = result.faceLandmarks?.[0] ?? null;
    const categories = result.faceBlendshapes?.[0]?.categories;
    const blendshapes = categories ? Object.fromEntries(categories.map((c)=>[
            c.categoryName,
            c.score
        ])) : null;
    return {
        landmarks,
        blendshapes
    };
}

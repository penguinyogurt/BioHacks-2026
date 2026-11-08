export type ExpressionId = "happy" | "sad" | "angry" | "surprised" | "disgust";
export type CaptureId = ExpressionId | "neutral";

export const EXPRESSIONS: { id: ExpressionId; label: string; cue: string }[] = [
  { id: "happy", label: "Happy", cue: "Smile as big as you can" },
  { id: "sad", label: "Sad", cue: "Frown, corners of the mouth down" },
  { id: "angry", label: "Angry", cue: "Scowl, brows pulled down" },
  { id: "surprised", label: "Surprised", cue: "Raise your eyebrows, open your mouth" },
  { id: "disgust", label: "Disgust", cue: "Wrinkle your nose" },
];

export const NEUTRAL_CUE = "Relax your face completely — neutral expression";

/**
 * The blendshapes each expression is actually defined by, loosely mapped to
 * the facial action units the ALS orofacial-kinematics literature tracks for
 * each gesture. Used to pick which muscle to lead with and to compute the
 * amplitude index — not "whichever blendshape happened to read highest."
 */
export const EXPRESSION_PRIMARY_BLENDSHAPES: Record<ExpressionId, string[]> = {
  happy: ["mouthSmileLeft", "mouthSmileRight", "cheekSquintLeft", "cheekSquintRight", "mouthDimpleLeft", "mouthDimpleRight"],
  sad: ["mouthFrownLeft", "mouthFrownRight", "browInnerUp", "mouthLowerDownLeft", "mouthLowerDownRight"],
  angry: ["browDownLeft", "browDownRight", "mouthPressLeft", "mouthPressRight", "noseSneerLeft", "noseSneerRight"],
  surprised: ["browInnerUp", "browOuterUpLeft", "browOuterUpRight", "eyeWideLeft", "eyeWideRight", "jawOpen"],
  disgust: ["noseSneerLeft", "noseSneerRight", "mouthUpperUpLeft", "mouthUpperUpRight", "browDownLeft", "browDownRight"],
};

/** Left/right MediaPipe blendshape base names used for the asymmetry index. */
export const ASYMMETRY_PAIRS = [
  "browDown",
  "browOuterUp",
  "cheekSquint",
  "eyeBlink",
  "eyeSquint",
  "eyeWide",
  "mouthDimple",
  "mouthFrown",
  "mouthLowerDown",
  "mouthPress",
  "mouthSmile",
  "mouthStretch",
  "mouthUpperUp",
  "noseSneer",
] as const;

export const HOLD_MS = 2000;
export const REPS_PER_EXPRESSION = 2;
export const RELAX_MS = 700;
export const COUNTDOWN_MS = 1500;
export const INSTRUCTION_MS = 1400;
export const NEUTRAL_HOLD_MS = 1800;

/** Minimum number of sessions (baseline + check-ins) before switching from a flat
 * percentage threshold to a robust z-score computed from the person's own history. */
export const MIN_SESSIONS_FOR_ROBUST_STATS = 3;

/** One blendshape vector: category name -> score (0-1). */
export type BlendshapeVector = Record<string, number>;

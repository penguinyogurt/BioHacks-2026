export type ExpressionId = "happy" | "sad" | "angry" | "surprised" | "disgust";

export const EXPRESSIONS: { id: ExpressionId; label: string; cue: string }[] = [
  { id: "happy", label: "Happy", cue: "Smile as big as you can" },
  { id: "sad", label: "Sad", cue: "Frown, corners of the mouth down" },
  { id: "angry", label: "Angry", cue: "Scowl, brows pulled down" },
  { id: "surprised", label: "Surprised", cue: "Raise your eyebrows, open your mouth" },
  { id: "disgust", label: "Disgust", cue: "Wrinkle your nose" },
];

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

export const HOLD_MS = 2500;
export const COUNTDOWN_MS = 2000;
export const INSTRUCTION_MS = 1500;

/** One blendshape vector: category name -> score (0-1). */
export type BlendshapeVector = Record<string, number>;

export const EXPRESSIONS = [
    {
        id: "happy",
        label: "Happy",
        cue: "Smile — as big and exaggerated as you can"
    },
    {
        id: "sad",
        label: "Sad",
        cue: "Frown, corners of the mouth pulled down, as far as you can"
    },
    {
        id: "angry",
        label: "Angry",
        cue: "Scowl, brows pulled down hard"
    },
    {
        id: "surprised",
        label: "Surprised",
        cue: "Raise your eyebrows as high as you can, open your mouth wide"
    },
    {
        id: "disgust",
        label: "Disgust",
        cue: "Wrinkle your nose as much as you can"
    }
];
export const NEUTRAL_CUE = "Relax your face completely — neutral expression";
export const EXPRESSIVENESS_REMINDER = "Go bigger than feels natural — a subtle version of the expression won't register as different from a weaker one.";
export const EXPRESSION_PRIMARY_BLENDSHAPES = {
    happy: [
        "mouthSmileLeft",
        "mouthSmileRight",
        "cheekSquintLeft",
        "cheekSquintRight",
        "mouthDimpleLeft",
        "mouthDimpleRight"
    ],
    sad: [
        "mouthFrownLeft",
        "mouthFrownRight",
        "browInnerUp",
        "mouthLowerDownLeft",
        "mouthLowerDownRight"
    ],
    angry: [
        "browDownLeft",
        "browDownRight",
        "mouthPressLeft",
        "mouthPressRight",
        "noseSneerLeft",
        "noseSneerRight"
    ],
    surprised: [
        "browInnerUp",
        "browOuterUpLeft",
        "browOuterUpRight",
        "eyeWideLeft",
        "eyeWideRight",
        "jawOpen"
    ],
    disgust: [
        "noseSneerLeft",
        "noseSneerRight",
        "mouthUpperUpLeft",
        "mouthUpperUpRight",
        "browDownLeft",
        "browDownRight"
    ]
};
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
    "noseSneer"
];
export const HOLD_MS = 2200;
export const REPS_PER_EXPRESSION = 2;
export const NEUTRAL_HOLD_MS = 1800;
export const MIN_SESSIONS_FOR_ROBUST_STATS = 3;

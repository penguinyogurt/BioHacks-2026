import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The CSS reduced-motion block in index.css only reaches CSS transitions.
        motion/react drives its own values, so without this every bar growth,
        card entrance and exit blur runs at full strength regardless of the OS
        setting. "user" keeps opacity and drops transforms — gentler, not
        zero — and useFunnelRun already handles the staged reveal. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);

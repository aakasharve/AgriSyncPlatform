import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { getStoredLanguage } from "./i18n";
import "./styles.css";

const container = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The prerendered HTML is English. Hydrate it in place when the first render
// will also be English, so the page is reused rather than repainted (repaint
// cost 3.5 s of LCP and a layout jump on a throttled phone). A returning
// Marathi reader would not match, so render fresh for them instead.
let stored: string | null = null;
try {
  stored = getStoredLanguage();
} catch {
  // storage blocked: treat as default (English)
}

if (container.hasChildNodes() && stored !== "mr") {
  hydrateRoot(container, app, {
    onRecoverableError: (error) => console.warn("[hydrate]", error),
  });
} else {
  container.textContent = "";
  createRoot(container).render(app);
}

import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// JSX goes through src/i18n-jsx so English is rendered by React itself, which
// lets the prerendered English HTML hydrate instead of being repainted.
const i18nJsx = fileURLToPath(new URL("./src/i18n-jsx", import.meta.url));

export default defineConfig({
  plugins: [react({ jsxImportSource: "@i18n-jsx" })],
  resolve: {
    alias: [
      { find: "@i18n-jsx/jsx-runtime", replacement: `${i18nJsx}/jsx-runtime.ts` },
      { find: "@i18n-jsx/jsx-dev-runtime", replacement: `${i18nJsx}/jsx-dev-runtime.ts` },
    ],
  },
});

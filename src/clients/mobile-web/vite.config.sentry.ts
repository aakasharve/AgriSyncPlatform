// vite.config.sentry.ts — NOTE: Source map upload configuration
// To enable: npm install @sentry/vite-plugin --save-dev
// Then add to vite.config.ts:
//
// import { sentryVitePlugin } from "@sentry/vite-plugin";
//
// plugins: [
//   sentryVitePlugin({
//     org: "agrisync",
//     project: "mobile-web",
//     authToken: process.env.SENTRY_AUTH_TOKEN,
//   }),
// ]
//
// Store SENTRY_AUTH_TOKEN in GitHub Actions secrets.
// See _COFOUNDER/runbooks/secrets-mgmt.md for rotation procedure.
export {};

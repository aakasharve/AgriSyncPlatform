# Static_V2 Marathi Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Marathi-first Static_V2 marketing site under `src/clients/Static_V2` using real ShramSafal brand assets, generated cinematic images, and Motion for React animation.

**Architecture:** Static_V2 is an isolated Vite React client. `src/App.tsx` owns section structure and motion orchestration, `src/styles.css` owns the art direction, `assets/brand` contains selected real brand files, and `assets/generated` contains text-free generated image assets.

**Tech Stack:** React 19, TypeScript, Vite, Motion for React, custom CSS, Node contract test.

---

### Task 1: Static_V2 Contract Test

**Files:**
- Create: `src/clients/Static_V2/tests/static-v2.spec.mjs`

- [ ] **Step 1: Write the failing test**

Create a Node contract test that requires the Vite files, Marathi hero copy, Motion imports, hover animation hooks, reduced-motion CSS, selected brand assets, generated images, and visual-only waitlist behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/clients/Static_V2/tests/static-v2.spec.mjs`

Expected: FAIL with `package.json should exist`, because the app shell is not created yet.

### Task 2: Vite React Shell

**Files:**
- Create: `src/clients/Static_V2/package.json`
- Create: `src/clients/Static_V2/index.html`
- Create: `src/clients/Static_V2/tsconfig.json`
- Create: `src/clients/Static_V2/vite.config.ts`
- Create: `src/clients/Static_V2/src/main.tsx`

- [ ] **Step 1: Add package scripts and dependencies**

Create scripts for `dev`, `build`, `preview`, and `test`. Add `@vitejs/plugin-react`, `typescript`, `vite`, `react`, `react-dom`, `motion`, `@types/react`, and `@types/react-dom`.

- [ ] **Step 2: Add HTML and React entry**

Set `lang="mr"` and mount React into `#root`.

### Task 3: Marathi Motion Page

**Files:**
- Create: `src/clients/Static_V2/src/App.tsx`
- Create: `src/clients/Static_V2/src/styles.css`

- [ ] **Step 1: Implement the page sections**

Add hero, daily reality, belief challenge, identity shift, product reveal, execution spine, time ladder, audience grid, and visual-only waitlist sections using the locked Marathi copy from the spec.

- [ ] **Step 2: Implement motion**

Use `useScroll`, `useTransform`, `useSpring`, `useMotionTemplate`, `useMotionValue`, `useReducedMotion`, `motion.*`, and `whileHover` for scroll-linked spine progress, ambient field light, granular card hover, and section reveal.

- [ ] **Step 3: Implement responsive styling**

Use large Devanagari type, approved Noto font stack, real image backgrounds, visible logo assets, reduced-motion behavior, and mobile-safe grids.

### Task 4: Verification

**Files:**
- Verify: `src/clients/Static_V2/tests/static-v2.spec.mjs`
- Verify: `src/clients/Static_V2/package.json`

- [ ] **Step 1: Run test**

Run: `npm test` from `src/clients/Static_V2`.

Expected: PASS with `Static_V2 contract checks passed`.

- [ ] **Step 2: Run build**

Run: `npm run build` from `src/clients/Static_V2`.

Expected: Vite build completes and writes an ignored `dist/` folder.

- [ ] **Step 3: Browser check**

Run the Vite dev server, open it in the in-app browser, and verify the first viewport shows Marathi Devanagari, cinematic imagery, hover-reactive cards, and no blank page.

/**
 * Render-time translation.
 *
 * The page copy is written in Marathi directly in the JSX. English used to be
 * swapped in afterwards by a DOM walker, which meant React's own first render
 * was always Marathi. That is fatal to hydration: the prerendered HTML is
 * English, so React could never reuse it and instead threw the whole page
 * away and repainted it — 3.5 s of extra LCP and a large layout shift on a
 * throttled phone.
 *
 * This runtime wraps React's and translates string children and the
 * translatable attributes of host elements as they are created, so React
 * renders English itself and the prerendered DOM matches. Vite points JSX at
 * this file via `jsxImportSource` (see vite.config.ts); types stay React's.
 */
import * as React from "react";
import * as runtime from "react/jsx-runtime";
import { translateHostProps } from "../i18n";

export const Fragment = runtime.Fragment;

type Props = Record<string, unknown>;

export function jsx(type: React.ElementType, props: Props, key?: React.Key) {
  return runtime.jsx(type, typeof type === "string" ? translateHostProps(props) : props, key);
}

export function jsxs(type: React.ElementType, props: Props, key?: React.Key) {
  return runtime.jsxs(type, typeof type === "string" ? translateHostProps(props) : props, key);
}

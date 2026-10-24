// Dev twin of ./jsx-runtime.ts — same translation, React's dev entry point.
import * as React from "react";
import * as runtime from "react/jsx-dev-runtime";
import { translateHostProps } from "../i18n";

export const Fragment = runtime.Fragment;

export function jsxDEV(
  type: React.ElementType,
  props: Record<string, unknown>,
  key: React.Key | undefined,
  isStatic: boolean,
  source?: unknown,
  self?: unknown,
) {
  return (runtime.jsxDEV as (...args: unknown[]) => React.ReactElement)(
    type,
    typeof type === "string" ? translateHostProps(props) : props,
    key,
    isStatic,
    source,
    self,
  );
}

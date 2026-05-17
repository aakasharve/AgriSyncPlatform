// spec: data-principle-spine-2026-05-05/06.4
// Per DS-015 (2026-05-17) Track-B verdict: every Marathi/Hindi/English
// legal string in Phase 06-11 ships tagged for counsel swap. CI gate
// .github/workflows/legal-review-gate.yml warns on push to any branch,
// BLOCKS on push to refs/heads/prod-deploy. Counsel removes the prefix
// by editing this constant in one place OR by per-string swap.
export const LEGAL_REVIEW_PENDING_PREFIX = "[LEGAL_REVIEW_PENDING] ";

export function tagLegalString(s: string): string {
    return LEGAL_REVIEW_PENDING_PREFIX + s;
}

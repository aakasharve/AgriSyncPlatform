/**
 * roleLabels — the single source of truth for how farm-membership
 * roles are rendered across the app.
 *
 * Why a registry?
 *   - Before CEI Phase 2 the app had four roles (PrimaryOwner,
 *     SecondaryOwner, Mukadam, Worker) and each surface (Memberships
 *     list, QR sheet, invite flow, admin MIS) hard-coded its own
 *     labels + badge colours. That bred inconsistencies — one screen
 *     called a Mukadam "Supervisor", another called them "Manager",
 *     and the Marathi copy drifted.
 *   - CEI Phase 2 §4.6 adds five new roles (Agronomist, Consultant,
 *     FpcTechnicalManager, FieldScout, LabOperator). Shipping them
 *     without a central registry would multiply the drift.
 *
 * Shape:
 *   - `en` / `mr` are the canonical labels shown in the UI. Marathi
 *     first in the display string, English kept alongside for the
 *     bilingual audience (matches the app's Marathi-first guideline).
 *   - `badge` is a tailwind class trio used by pill/chip components.
 *   - `short` is a trimmed Marathi-only label for tight chips (nav,
 *     cards). Falls back to `mr` when no short form exists.
 *
 * Anti-ego guidance: the *role names* are role names — owner,
 * consultant, mukadam. They are never framed as "higher" or "lower"
 * than one another in copy. The registry only provides labels, not
 * policy.
 */

export type FarmRole =
    | 'PrimaryOwner'
    | 'SecondaryOwner'
    | 'Mukadam'
    | 'Worker'
    | 'Agronomist'
    | 'Consultant'
    | 'FpcTechnicalManager'
    | 'FieldScout'
    | 'LabOperator';

export interface RoleLabel {
    /** Canonical role code — matches the backend Enum name */
    code: FarmRole;
    /** English label */
    en: string;
    /** Marathi label */
    mr: string;
    /** Short Marathi label for tight chips; defaults to `mr` */
    short: string;
    /** Tailwind class trio: `bg-* text-* border-*` */
    badge: string;
    /**
     * Marathi · English display string suitable for badges. Keeps
     * Marathi first per the app style guide.
     */
    display: string;
}

const make = (
    code: FarmRole,
    en: string,
    mr: string,
    badge: string,
    short?: string,
): RoleLabel => ({
    code,
    en,
    mr,
    short: short ?? mr,
    badge,
    display: `${mr} · ${en}`,
});

export const ROLE_LABELS: Record<FarmRole, RoleLabel> = {
    // Existing four — labels preserved verbatim from MembershipsList so
    // this change is a refactor, not a rename.
    PrimaryOwner: make(
        'PrimaryOwner',
        'Owner',
        'मालक',
        'bg-emerald-50 text-emerald-700 border-emerald-200',
    ),
    SecondaryOwner: make(
        'SecondaryOwner',
        'Co-owner',
        'सहमालक',
        'bg-blue-50 text-blue-700 border-blue-200',
    ),
    Mukadam: make(
        'Mukadam',
        'Mukadam',
        'मुकादम',
        'bg-orange-50 text-orange-700 border-orange-200',
    ),
    Worker: make(
        'Worker',
        'Worker',
        'कामगार',
        'bg-stone-100 text-stone-700 border-stone-200',
    ),

    // CEI Phase 2 §4.6 — five new roles. Badge colours chosen to
    // stay tonally distinct from the existing four while keeping the
    // visual weight of "professional advisor" roles (teal/indigo/slate)
    // separate from "field" roles (lime/sky).
    Agronomist: make(
        'Agronomist',
        'Agronomist',
        'कृषितज्ज्ञ',
        'bg-teal-50 text-teal-700 border-teal-200',
    ),
    Consultant: make(
        'Consultant',
        'Consultant',
        'सल्लागार',
        'bg-indigo-50 text-indigo-700 border-indigo-200',
    ),
    FpcTechnicalManager: make(
        'FpcTechnicalManager',
        'FPC Technical Manager',
        'FPC तांत्रिक व्यवस्थापक',
        'bg-slate-100 text-slate-700 border-slate-300',
        'FPC तांत्रिक',
    ),
    FieldScout: make(
        'FieldScout',
        'Field Scout',
        'शेत निरीक्षक',
        'bg-lime-50 text-lime-700 border-lime-200',
    ),
    LabOperator: make(
        'LabOperator',
        'Lab Operator',
        'प्रयोगशाळा',
        'bg-sky-50 text-sky-700 border-sky-200',
    ),
};

/**
 * Resolve a role code to its label record. Unknown codes fall back to
 * a neutral "Member" label so the UI never crashes on a new server
 * role the frontend has not learned about yet.
 */
export const getRoleLabel = (code: string | null | undefined): RoleLabel => {
    if (code && (code in ROLE_LABELS)) {
        return ROLE_LABELS[code as FarmRole];
    }
    return {
        code: 'Worker',
        en: 'Member',
        mr: 'सदस्य',
        short: 'सदस्य',
        badge: 'bg-stone-100 text-stone-700 border-stone-200',
        display: 'सदस्य · Member',
    };
};

/**
 * Ordered list used by role pickers / QR generation sheets so the
 * options show up in a stable sequence (owner roles first, then
 * professional advisors, then operational roles).
 */
export const ROLE_OPTIONS: FarmRole[] = [
    'PrimaryOwner',
    'SecondaryOwner',
    'Agronomist',
    'Consultant',
    'FpcTechnicalManager',
    'Mukadam',
    'FieldScout',
    'LabOperator',
    'Worker',
];

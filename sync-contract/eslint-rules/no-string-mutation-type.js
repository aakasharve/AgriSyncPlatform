// ESLint flat-config local rule: forbids string literals matching a sync
// mutation type name outside the canonical catalog module.
//
// Why: pre-Sub-plan-02, sync mutation names were sprinkled across the
// codebase as raw string literals (in switch cases, allow-list Sets,
// dispatch tables, test fixtures). Adding a new mutation required
// updating ~5 locations or it would silently fail at sync time. After
// Sub-plan 02, mutation names live in exactly one place
// (sync-contract/schemas/mutation-types.json) and code references them
// via SyncMutationCatalog. This rule is the enforcement.
//
// Allowed locations (rule self-disables):
// - the SyncMutationCatalog module itself (TS or C#)
// - anything inside sync-contract/ (the source of truth + its tools)
//
// Everywhere else, a literal like 'create_daily_log' is an error;
// the codebase must import { SyncMutationCatalog } from '...' and read
// SyncMutationCatalog['create_daily_log'].name (or use the type union).
//
// For deliberate raw-string usage (e.g. constructing a JSON payload
// where the field must be a literal string), suppress with:
//   // eslint-disable-next-line local-rules/no-string-mutation-type
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWN = JSON.parse(
    readFileSync(resolve(__dirname, '../schemas/mutation-types.json'), 'utf8'),
).mutationTypes.map((m) => m.name);

const KNOWN_SET = new Set(KNOWN);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid string literals matching a sync mutation type name outside the catalog module',
        },
        schema: [],
        messages: {
            stringly:
                'Mutation type "{{name}}" must be referenced via SyncMutationCatalog (import from "infrastructure/sync/SyncMutationCatalog"). Raw string literals drift away from the canonical contract.',
        },
    },
    create(context) {
        const file = context.filename ?? context.getFilename();
        // The catalog module itself + the sync-contract workspace are the
        // only places where bare mutation-name strings are allowed.
        const normalized = file.replace(/\\/g, '/');
        if (
            normalized.includes('SyncMutationCatalog') ||
            normalized.includes('/sync-contract/')
        ) {
            return {};
        }
        return {
            Literal(node) {
                if (typeof node.value !== 'string') return;
                if (KNOWN_SET.has(node.value)) {
                    context.report({
                        node,
                        messageId: 'stringly',
                        data: { name: node.value },
                    });
                }
            },
        };
    },
};

export default rule;
export { KNOWN as KNOWN_MUTATION_NAMES };

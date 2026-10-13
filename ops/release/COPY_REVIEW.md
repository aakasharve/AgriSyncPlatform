# Copy-review registry

`copy-review-registry.json` lists the user-facing legal / consent / privacy copy that needs
counsel review. `copy_review_check.mjs` compares each file's current hash with the registry.
It does not assess legal validity, and a passing run is not evidence that any copy is
compliant or reviewed. Sign-off records live in the private review records (Repository B);
this registry only stores an identifier that points at them.

## Fields

- `audience` (registry level): `founder_testing` or `real_farmers`.
- per file: `path`, `reviewStatus` (`unreviewed` | `signed_off`), `sha256` (current content,
  informational). For `signed_off` files also `signOffRef` (an identifier of the private
  record, no private content) and `reviewedSha256` (hash of the exact text that was reviewed).
- `coverage`: directories and filename patterns in which every copy-bearing file must be
  listed, so new legal copy cannot be added without being registered.

Hashes are sha256 of the file with CRLF normalised to LF.

## The two audiences

| audience | unreviewed files | any branch (report mode) | prod-deploy (enforce mode) |
|---|---|---|---|
| `founder_testing` | allowed; reported as "N files awaiting counsel review; not cleared for real-farmer onboarding" | exit 0 | exit 0 |
| `real_farmers` | not allowed | warns, exit 0 | fails unless every file is `signed_off`, hash matches, `signOffRef` non-empty |

In both audiences, and in both modes, these always fail: a listed file is missing; a covered
copy file is not in the registry; a `signed_off` file's current hash differs from
`reviewedSha256` (an edit after sign-off means it is unreviewed again and must be recorded);
a `signed_off` entry without `reviewedSha256` or `signOffRef`; a malformed registry.

There is no date logic. Switching `audience` to `real_farmers` is an explicit, reviewed commit.

## Commands (from the repo root)

    node ops/release/copy_review_check.mjs --mode report
    node ops/release/copy_review_check.mjs --mode enforce
    node ops/release/copy_review_check.mjs --update-hashes
    node ops/release/copy_review_check.mjs --update-hashes --reset-changed-signoffs
    node --test ops/release/copy_review_check.test.mjs

`--update-hashes` refreshes `sha256`, keeps every `reviewStatus`, and adds newly found covered
files as `unreviewed`. It never removes entries and never touches `audience`. A `signed_off`
file whose content changed is left as is (the check then fails) unless
`--reset-changed-signoffs` is also given, which records it as `unreviewed` and keeps the old
reference in `priorSignOffRef`.

## Recording a sign-off

1. Counsel reviews the exact current text. Record the review in the private records and note
   its record identifier.
2. Run `--update-hashes` so `sha256` is current, then in the registry set the file to
   `"reviewStatus": "signed_off"`, `"signOffRef": "<record id>"`, `"reviewedSha256": "<that
   file's sha256>"`. Commit via a normal reviewed PR.
3. Editing a signed-off file afterwards fails the check until the entry is reset to
   `unreviewed` (`--update-hashes --reset-changed-signoffs`) or re-signed.

## Switching audience

Change `"audience"` to `real_farmers` in a dedicated, reviewed commit. Enforce mode on
`prod-deploy` will then fail until every listed file is signed off with a matching hash.

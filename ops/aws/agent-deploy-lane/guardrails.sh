#!/usr/bin/env bash
#
# Pure-bash guardrail predicates extracted from agent-cutover.sh so
# they can be unit-tested in isolation (no AWS, no git side-effects).
#
# Every function returns 0 on PASS and non-zero on FAIL. Stdout/stderr
# is informational only — tests should assert on exit codes.

# guardrail_sha_well_formed <sha>
# 0 if 7-40 hex chars, 1 otherwise.
guardrail_sha_well_formed() {
    local sha="${1:-}"
    if [[ -z "$sha" ]]; then
        echo "DEPLOY_SHA missing"
        return 1
    fi
    if ! [[ "$sha" =~ ^[a-f0-9]{7,40}$ ]]; then
        echo "DEPLOY_SHA must be 7-40 hex chars: $sha"
        return 1
    fi
    return 0
}

# guardrail_runbook_pins_sha <runbook-path> <short-sha>
# Verifies the runbook file exists AND contains the SHA prefix.
guardrail_runbook_pins_sha() {
    local runbook_path="${1:-}"
    local short_sha="${2:-}"
    if [[ -z "$runbook_path" || -z "$short_sha" ]]; then
        echo "runbook path or short SHA missing"
        return 1
    fi
    if [[ ! -f "$runbook_path" ]]; then
        echo "runbook not found: $runbook_path"
        return 1
    fi
    if ! grep -q "$short_sha" "$runbook_path"; then
        echo "runbook $runbook_path does not mention SHA $short_sha"
        return 1
    fi
    return 0
}

# guardrail_no_forbidden_migration <migrations-dir> <space-separated-forbidden-list>
# Checks the directory for any forbidden migration files (presence aborts).
guardrail_no_forbidden_migration() {
    local migrations_dir="${1:-}"
    local forbidden="${2:-}"
    if [[ -z "$migrations_dir" ]]; then
        echo "migrations dir missing"
        return 1
    fi
    if [[ ! -d "$migrations_dir" ]]; then
        # missing dir -> nothing forbidden present (vacuously true)
        return 0
    fi
    for f in $forbidden; do
        if [[ -n "$f" && -f "$migrations_dir/$f" ]]; then
            echo "forbidden migration present: $f"
            return 1
        fi
    done
    return 0
}

# guardrail_all_ci_runs_green <stdin: tab-separated name<TAB>status<TAB>conclusion lines>
# 0 if every line's third column is "success", non-zero otherwise.
# Empty input -> non-zero (no CI evidence is a fail).
guardrail_all_ci_runs_green() {
    local lines
    lines="$(cat)"
    if [[ -z "$lines" ]]; then
        echo "no CI runs found"
        return 1
    fi
    if echo "$lines" | awk -F'\t' '{print $3}' | grep -qvE '^(success)$'; then
        echo "at least one CI run not success"
        return 1
    fi
    return 0
}

# guardrail_confirm_flag_present <flags...>
# 0 if "--confirm" appears in args.
guardrail_confirm_flag_present() {
    for arg in "$@"; do
        if [[ "$arg" == "--confirm" ]]; then
            return 0
        fi
    done
    echo "--confirm flag missing"
    return 1
}

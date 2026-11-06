#!/usr/bin/env python3
"""NuGet vulnerability gate (spec: nuget-audit-hardening-2026-11-01).

Reads the JSON that `dotnet list <sln> package --vulnerable --include-transitive
--format json` writes and FAILS the build when any High/Critical advisory is not
covered by a valid entry in .github/security/nuget-audit-exceptions.json.

Why a script and not only NuGet's own NU1903/NU1904 build errors: the build
error is all-or-nothing per advisory category, it says nothing about WHO accepted
a finding or WHEN that acceptance ends, and a `<WarningsNotAsErrors>NU1903` line
silently turns it off for every project. This gate keeps the full report
(every severity is printed and the JSON is uploaded as a CI artifact) and makes
exceptions narrow and self-expiring.

An exception covers exactly: one advisory + one package + one version + one
project. It must name an owner and a tracking issue and it expires on a date the
gate enforces (default max life 60 days). The matching `NuGetAuditSuppress`
item must live in that project's own .csproj, so the build and this gate agree.

Exit codes: 0 = clean, 1 = policy violation, 2 = bad input.
Python 3, standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

BLOCKING = {"high", "critical"}
MAX_EXCEPTION_DAYS = 60
GHSA_RE = re.compile(r"GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}", re.IGNORECASE)
REQUIRED_FIELDS = (
    "advisory", "package", "version", "project",
    "owner", "issue", "reason", "granted", "expires",
)


def norm_path(p: str, root: Path) -> str:
    """Repo-relative, forward-slash, lower-cased, so Windows/Linux reports compare equal."""
    path = Path(p)
    try:
        path = path.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        pass
    return str(path).replace("\\", "/").lower()


def load_findings(report_path: Path, root: Path):
    data = json.loads(report_path.read_text(encoding="utf-8-sig"))
    findings = []
    for proj in data.get("projects", []):
        project = norm_path(proj.get("path", ""), root)
        for fw in proj.get("frameworks", []):
            for key in ("topLevelPackages", "transitivePackages"):
                for pkg in fw.get(key, []) or []:
                    for vuln in pkg.get("vulnerabilities", []) or []:
                        m = GHSA_RE.search(vuln.get("advisoryurl", ""))
                        findings.append({
                            "project": project,
                            "package": pkg.get("id", ""),
                            "version": pkg.get("resolvedVersion", ""),
                            "severity": str(vuln.get("severity", "")).lower(),
                            "advisory": (m.group(0) if m else vuln.get("advisoryurl", "")).upper(),
                            "url": vuln.get("advisoryurl", ""),
                        })
    # Same finding repeats once per target framework; collapse.
    unique = {(f["project"], f["package"].lower(), f["version"], f["advisory"]): f for f in findings}
    return list(unique.values())


def load_register(path: Path):
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    entries = data.get("exceptions", [])
    if not isinstance(entries, list):
        raise ValueError("'exceptions' must be a list")
    return entries


def validate_entry(e, today: dt.date, root: Path):
    """Returns a list of problem strings (empty = entry is valid and in force)."""
    problems = []
    label = f"{e.get('advisory', '?')} / {e.get('package', '?')} {e.get('version', '?')} / {e.get('project', '?')}"
    missing = [f for f in REQUIRED_FIELDS if not str(e.get(f, "")).strip()]
    if missing:
        return [f"exception [{label}] is missing field(s): {', '.join(missing)}"]
    if not GHSA_RE.fullmatch(e["advisory"]):
        problems.append(f"exception [{label}]: 'advisory' must be one GHSA id")
    if "*" in e["version"] or "[" in e["version"] or "," in e["version"]:
        problems.append(f"exception [{label}]: 'version' must be one exact version, not a range")
    if "*" in e["project"] or not e["project"].lower().endswith(".csproj"):
        problems.append(f"exception [{label}]: 'project' must be one exact .csproj path")
    elif not (root / e["project"]).is_file():
        problems.append(f"exception [{label}]: project file does not exist")
    if not re.search(r"(#\d+|/issues/\d+)", e["issue"]):
        problems.append(f"exception [{label}]: 'issue' must reference a tracking issue (#123 or an /issues/123 URL)")
    try:
        granted = dt.date.fromisoformat(e["granted"])
        expires = dt.date.fromisoformat(e["expires"])
    except ValueError:
        return problems + [f"exception [{label}]: 'granted'/'expires' must be YYYY-MM-DD"]
    if (expires - granted).days > MAX_EXCEPTION_DAYS:
        problems.append(f"exception [{label}]: lifetime {(expires - granted).days}d exceeds the {MAX_EXCEPTION_DAYS}d maximum")
    if expires < today:
        problems.append(f"exception [{label}]: EXPIRED on {expires} (owner {e['owner']}). Fix the dependency or renew via a reviewed PR")
    return problems


def scan_tamper(root: Path):
    """Reject the ways a blanket exemption can come back in unnoticed."""
    problems = []
    suppress_sites = []
    for f in list(root.rglob("*.csproj")) + list(root.rglob("*.props")) + list(root.rglob("*.targets")):
        parts = {p.lower() for p in f.parts}
        if {"node_modules", "obj", "bin", ".git", "_cofounder"} & parts:
            continue
        text = f.read_text(encoding="utf-8-sig", errors="replace")
        rel = norm_path(str(f), root)
        # Strip XML comments so documentation that mentions these names is not a hit.
        live = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
        if re.search(r"<NuGetAudit>\s*false\s*</NuGetAudit>", live, re.IGNORECASE):
            problems.append(f"{rel}: NuGetAudit is switched off")
        if re.search(r"<NuGetAuditLevel>\s*(critical)\s*</NuGetAuditLevel>", live, re.IGNORECASE):
            problems.append(f"{rel}: NuGetAuditLevel=critical hides high-severity findings")
        for tag in ("WarningsNotAsErrors", "NoWarn", "WarningsAsMessages"):
            for body in re.findall(rf"<{tag}>(.*?)</{tag}>", live, re.DOTALL | re.IGNORECASE):
                for code in ("NU1903", "NU1904"):
                    if code in body.upper():
                        problems.append(f"{rel}: <{tag}> mentions {code}; high/critical audit findings must not be exempted by category")
        for m in re.finditer(r'<NuGetAuditSuppress\s+Include="([^"]+)"', live, re.IGNORECASE):
            suppress_sites.append((rel, m.group(1)))
    return problems, suppress_sites


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True, help="JSON from `dotnet list package --vulnerable --format json`")
    ap.add_argument("--register", default=".github/security/nuget-audit-exceptions.json")
    ap.add_argument("--root", default=".")
    ap.add_argument("--today", help="override today's date (YYYY-MM-DD) for testing")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    today = dt.date.fromisoformat(args.today) if args.today else dt.datetime.now(dt.timezone.utc).date()
    try:
        findings = load_findings(Path(args.report), root)
        entries = load_register(root / args.register)
    except (OSError, ValueError, json.JSONDecodeError) as ex:
        print(f"::error::cannot read inputs: {ex}")
        return 2

    violations = []

    # 1. The exception register itself.
    valid_entries = []
    for e in entries:
        problems = validate_entry(e, today, root)
        violations += problems
        if not problems:
            valid_entries.append(e)

    # 2. Every finding, all severities, printed; blocking ones need a valid exception.
    print(f"NuGet audit gate - {today} - {len(findings)} finding(s) in the report\n")
    used = set()
    for f in sorted(findings, key=lambda x: (x["severity"] != "critical", x["severity"] != "high", x["project"], x["package"])):
        covering = next((i for i, e in enumerate(valid_entries)
                         if e["advisory"].upper() == f["advisory"]
                         and e["package"].lower() == f["package"].lower()
                         and e["version"] == f["version"]
                         and e["project"].lower() == f["project"]), None)
        blocking = f["severity"] in BLOCKING
        status = "ACCEPTED (exception in force)" if covering is not None else ("BLOCKING" if blocking else "reported, non-blocking")
        print(f"  [{f['severity'].upper():8}] {f['advisory']}  {f['package']} {f['version']}  in {f['project']}  -> {status}")
        if covering is not None:
            used.add(covering)
        elif blocking:
            violations.append(f"{f['severity'].upper()} {f['advisory']} in {f['package']} {f['version']} ({f['project']}) has no valid exception. {f['url']}")

    # 3. An exception that no longer matches a finding is dead weight and a loophole: remove it.
    for i, e in enumerate(valid_entries):
        if i not in used:
            violations.append(
                f"exception for {e['advisory']} / {e['package']} {e['version']} / {e['project']} matches no current finding "
                "(fixed, version changed, or never applied). Remove it from the register and its NuGetAuditSuppress line")

    # 4. Suppress lines in project files must correspond to a valid register entry in that exact project.
    tamper, suppress_sites = scan_tamper(root)
    violations += tamper
    for rel, include in suppress_sites:
        ghsa = GHSA_RE.search(include)
        if not rel.endswith(".csproj"):
            violations.append(f"{rel}: NuGetAuditSuppress in a shared props/targets file; it must sit in the one project's own .csproj")
            continue
        if not ghsa or not any(e["advisory"].upper() == ghsa.group(0).upper() and e["project"].lower() == rel for e in valid_entries):
            violations.append(f"{rel}: NuGetAuditSuppress '{include}' has no valid register entry for this project")

    print()
    if violations:
        print("NuGet audit gate: FAILED")
        for v in violations:
            print(f"::error::{v}")
        return 1
    print("NuGet audit gate: passed (no unaccepted high/critical findings)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

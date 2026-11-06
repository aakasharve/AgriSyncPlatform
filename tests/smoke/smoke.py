#!/usr/bin/env python3
"""ShramSafal smoke suite (spec: plr-d10-redesign-real-integration-2026-10-25, lane OPS-1, F38).

Given a base URL and a test login, checks the liveness and readiness probes, the build identity, and a handful
of key read routes, and judges each by its REAL HTTP status code and body shape. It never concludes anything from
"no errors in the log": a check passes only when the server answered what was asked.

Usage:
    SMOKE_PHONE=<test phone> SMOKE_PASSWORD=<test password> \
        python tests/smoke/smoke.py --base-url https://api.example.com [--expect-sha <git sha or prefix>]
    python tests/smoke/smoke.py --base-url http://localhost:5048 --no-login     # public probes only

Exit codes: 0 every check passed; 1 at least one check failed; 2 usage error (including: no login given and
--no-login not stated, because a "smoke" with no reads would be reported green by omission).
The password is read from the environment only, never from an argument, and is never printed.
Standard library only, so it runs on a bare deploy host.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field


@dataclass
class Result:
    name: str
    ok: bool
    detail: str


@dataclass
class Smoke:
    base_url: str
    timeout: float = 20.0
    results: list[Result] = field(default_factory=list)

    def request(self, method: str, path: str, token: str | None = None, body: dict | None = None):
        """Returns (status, parsed_json_or_None, raw_text). A transport failure is status 0, never an exception."""
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base_url.rstrip("/") + path, data=data, method=method)
        req.add_header("Accept", "application/json")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status, raw = resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            status, raw = err.code, err.read().decode("utf-8", "replace")
            err.close()
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            return 0, None, f"transport error: {err}"
        try:
            return status, json.loads(raw), raw
        except ValueError:
            return status, None, raw

    def record(self, name: str, ok: bool, detail: str) -> None:
        self.results.append(Result(name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")

    def expect(self, name: str, method: str, path: str, want_status: int, shape=None, token=None, body=None):
        status, parsed, raw = self.request(method, path, token, body)
        if status != want_status:
            self.record(name, False, f"{method} {path} -> {status} (wanted {want_status})")
            return None
        if shape is not None:
            problem = shape(parsed)
            if problem:
                self.record(name, False, f"{method} {path} -> {status} but {problem}")
                return None
        self.record(name, True, f"{method} {path} -> {status}")
        return parsed


def has(key: str, value=None):
    def check(parsed):
        if not isinstance(parsed, dict) or key not in parsed:
            return f"body has no '{key}'"
        if value is not None and parsed[key] != value:
            return f"'{key}' is {parsed[key]!r}, wanted {value!r}"
        return None

    return check


def is_list(parsed):
    return None if isinstance(parsed, list) else "body is not a JSON array"


def is_object(parsed):
    return None if isinstance(parsed, dict) else "body is not a JSON object"


def run(base_url: str, phone: str | None, password: str | None, no_login: bool, expect_sha: str | None) -> int:
    s = Smoke(base_url)

    s.expect("liveness", "GET", "/health", 200, has("status", "healthy"))
    s.expect("readiness (touches both databases)", "GET", "/health/ready", 200, has("status", "ready"))

    version = s.expect("build identity", "GET", "/version", 200, has("buildSha"))
    if version is not None:
        sha = str(version.get("buildSha", ""))
        if sha in ("", "unknown"):
            s.record("build sha is real", False, "/version reports buildSha 'unknown'")
        elif expect_sha and not (sha.startswith(expect_sha) or expect_sha.startswith(sha)):
            s.record("build sha is the one just deployed", False, f"/version buildSha {sha[:12]} != expected {expect_sha[:12]}")
        else:
            s.record("build sha is real", True, f"buildSha {sha[:12]}")

    s.expect("phone app version", "GET", "/version/app", 200)
    s.expect("auth is enforced (no token)", "GET", "/shramsafal/farms/mine", 401)

    if not no_login:
        status, parsed, _ = s.request("POST", "/user/auth/login", body={"phone": phone, "password": password})
        token = parsed.get("accessToken") if isinstance(parsed, dict) else None
        if status != 200 or not token:
            s.record("login", False, f"POST /user/auth/login -> {status}" + ("" if token else ", no accessToken"))
        else:
            s.record("login", True, "POST /user/auth/login -> 200")
            s.expect("my farms", "GET", "/shramsafal/farms/mine", 200, is_list, token=token)
            s.expect("full sync pull", "GET", "/sync/pull?since=0", 200, is_object, token=token)
            s.expect("my consent", "GET", "/shramsafal/consent/me", 200, is_object, token=token)

    failed = [r for r in s.results if not r.ok]
    print(f"\n{len(s.results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--no-login", action="store_true", help="check the public probes only (states that the reads are skipped)")
    ap.add_argument("--expect-sha", help="the git sha (or prefix) that was just deployed; /version must match")
    args = ap.parse_args(argv)

    phone, password = os.environ.get("SMOKE_PHONE"), os.environ.get("SMOKE_PASSWORD")
    if not args.no_login and not (phone and password):
        print("usage error: set SMOKE_PHONE and SMOKE_PASSWORD, or pass --no-login to run the public probes only", file=sys.stderr)
        return 2
    return run(args.base_url, phone, password, args.no_login, args.expect_sha)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

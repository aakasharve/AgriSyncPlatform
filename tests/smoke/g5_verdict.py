#!/usr/bin/env python3
"""G5 heartbeat verdict (spec: plr-d10-redesign-real-integration-2026-10-25, lane OPS-1, F38).

The post-deploy check reads the CloudWatch metric `MutationRejected` and must never score GREEN when there is no
data. An idle or non-publishing server looks exactly like a healthy one from the outside; the server therefore
emits a one-minute ZERO heartbeat (see MutationRejectedMetricCollector), and "no datapoints at all" means the
publisher is not running, which is NOT healthy.

Input: the JSON printed by `aws cloudwatch get-metric-statistics ... --statistics Sum` (read from a file or stdin).
Verdicts and exit codes:
    GREEN    0   at least --min-datapoints datapoints and every Sum is 0
    RED      2   any datapoint with Sum > 0 (farmer writes are being rejected)
    NO_DATA  3   fewer than --min-datapoints datapoints (the heartbeat is missing)
A malformed input is exit 4. NO_DATA and RED both fail the deploy check.
"""
from __future__ import annotations

import argparse
import json
import sys


def verdict(document: dict, min_datapoints: int) -> tuple[str, str]:
    points = document.get("Datapoints")
    if not isinstance(points, list):
        raise ValueError("input has no 'Datapoints' list")
    sums = [float(p.get("Sum", 0.0)) for p in points]
    if any(v > 0 for v in sums):
        return "RED", f"{sum(1 for v in sums if v > 0)} of {len(sums)} datapoints show rejected mutations (total {sum(sums):g})"
    if len(sums) < min_datapoints:
        return "NO_DATA", f"{len(sums)} datapoints, need at least {min_datapoints}: the heartbeat is missing, not zero"
    return "GREEN", f"{len(sums)} datapoints, all zero"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help="JSON file (default: stdin)")
    ap.add_argument("--min-datapoints", type=int, default=3)
    args = ap.parse_args(argv)
    try:
        text = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
        word, why = verdict(json.loads(text), args.min_datapoints)
    except (OSError, ValueError) as err:
        print(f"G5 verdict: INPUT_ERROR  {err}")
        return 4
    print(f"G5 verdict: {word}  {why}")
    return {"GREEN": 0, "RED": 2, "NO_DATA": 3}[word]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""G5 heartbeat verdict (spec: plr-d10-redesign-real-integration-2026-10-25, lane OPS-1, F38; fix round 1, M1).

The post-deploy check reads the CloudWatch metric `MutationRejected` and must never score GREEN when there is no
data. An idle or non-publishing server looks exactly like a healthy one from the outside; the server therefore
emits a one-minute ZERO heartbeat (see MutationRejectedMetricCollector), and "no datapoints at all" means the
publisher is not running, which is NOT healthy.

Input: the JSON printed by `aws cloudwatch get-metric-statistics ... --statistics Sum` (read from a file or stdin).
What counts as a heartbeat: a datapoint that HAS a numeric, non-negative `Sum` (a point with only `Average`, or with a NaN,
missing or negative Sum, is no evidence) and a `Timestamp` at or after `--since <deploy time>`, which is REQUIRED: heartbeats the OLD
binary published before the deploy prove nothing about the new one, and without a start time a year-old heartbeat would pass.

Verdicts and exit codes:
    GREEN    0   at least --min-datapoints heartbeats and every Sum is 0
    RED      2   any heartbeat with Sum > 0 (farmer writes are being rejected)
    NO_DATA  3   fewer than --min-datapoints heartbeats (the heartbeat is missing)
A malformed input or an unusable option is exit 4. NO_DATA and RED both fail the deploy check.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone


def parse_time(text: str) -> datetime:
    """ISO 8601 (a trailing Z is accepted). A time with no zone is taken as UTC."""
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def verdict(document: dict, min_datapoints: int, since: datetime) -> tuple[str, str]:
    if min_datapoints < 1:
        raise ValueError("--min-datapoints must be at least 1: zero datapoints can never be a healthy heartbeat")
    points = document.get("Datapoints")
    if not isinstance(points, list):
        raise ValueError("input has no 'Datapoints' list")

    sums: list[float] = []
    ignored = 0
    for point in points:
        value = point.get("Sum") if isinstance(point, dict) else None
        if not isinstance(value, (int, float)) or isinstance(value, bool) or math.isnan(value) or value < 0:
            ignored += 1  # no Sum, not a number, or negative (a count cannot be): not a heartbeat
            continue
        stamp = point.get("Timestamp")
        try:
            when = parse_time(stamp) if isinstance(stamp, str) else None
        except ValueError:
            when = None
        if when is None or when < since:
            ignored += 1  # before the deploy (or undated): says nothing about the new binary
            continue
        sums.append(float(value))

    note = f" ({ignored} datapoints ignored: no usable Sum, or older than the deploy)" if ignored else ""
    if any(v > 0 for v in sums):
        return "RED", f"{sum(1 for v in sums if v > 0)} of {len(sums)} datapoints show rejected mutations (total {sum(sums):g}){note}"
    if len(sums) < min_datapoints:
        return "NO_DATA", f"{len(sums)} heartbeats, need at least {min_datapoints}: the heartbeat is missing, not zero{note}"
    return "GREEN", f"{len(sums)} heartbeats, all zero{note}"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help="JSON file (default: stdin)")
    ap.add_argument("--min-datapoints", type=int, default=3)
    ap.add_argument("--since", required=True, help="deploy time (ISO 8601): only heartbeats at or after it count (required)")
    args = ap.parse_args(argv)
    try:
        since = parse_time(args.since)
        text = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
        word, why = verdict(json.loads(text), args.min_datapoints, since)
    except (OSError, ValueError) as err:
        print(f"G5 verdict: INPUT_ERROR  {err}")
        return 4
    print(f"G5 verdict: {word}  {why}")
    return {"GREEN": 0, "RED": 2, "NO_DATA": 3}[word]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

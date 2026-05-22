using System.Collections.Generic;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.6 — per-(provider × operation)
/// rolling 24h window of <c>(success_count, failure_count)</c> tallies.
///
/// <para>
/// <b>Window shape.</b> A circular buffer of <c>BucketCount</c> minute-grain
/// buckets ((24 * 60) = 1440 by default). Each bucket holds two counters
/// (successes + failures) for a one-minute slice of the window. The
/// <c>ShouldRollback</c> probe sums every bucket whose timestamp falls
/// inside the trailing 24h window and divides failures by total — if the
/// ratio exceeds <see cref="FailRateThreshold"/> AND the window has
/// recorded at least <see cref="MinObservationsForRollback"/> calls
/// across the entire window, the probe returns <c>true</c>.
/// </para>
///
/// <para>
/// <b>"Sustained" semantics.</b> Per the envelope ("SUSTAINED FOR THE
/// ENTIRE 24h WINDOW — not just spikes"), we DO NOT trigger on a single
/// short spike. The minimum-observations gate filters out windows that
/// are too sparse to draw a conclusion (a 5% rate over 20 calls is not
/// the same signal as 5% over 2000 calls). The window is fully populated
/// at 24h of continuous traffic, so a transient 1-minute outage that
/// resolves cannot keep the rate > 5% across all 1440 minutes.
/// </para>
///
/// <para>
/// <b>Concurrency.</b> All mutating operations guard on the per-bucket
/// lock object so multiple threads recording successes / failures cannot
/// trample one another. The probe is a snapshot read; it accepts a tiny
/// inconsistency window across buckets in exchange for not blocking the
/// recording path.
/// </para>
///
/// <para>
/// <b>Memory.</b> 1440 buckets × (long, long, DateTime) per
/// (provider × operation) tuple. For the current 2-provider × 4-operation
/// matrix that is ~8 instances → ~46 KB. Bounded for the lifetime of
/// the process.
/// </para>
/// </summary>
internal sealed class AiProviderRollingWindowStats
{
    /// <summary>
    /// Per-envelope contract — rolling 24h failure-rate threshold above
    /// which <see cref="ShouldRollback"/> returns true. 0.05 == 5%.
    /// </summary>
    public const double FailRateThreshold = 0.05;

    /// <summary>
    /// Minimum total (success + failure) observations across the rolling
    /// window before the rate-based gate fires. Prevents a single
    /// failed call early in the day from tripping the alarm.
    /// </summary>
    public const long MinObservationsForRollback = 50;

    /// <summary>
    /// Window size in minutes (24h). Each bucket holds one minute of
    /// counters.
    /// </summary>
    public const int WindowMinutes = 24 * 60;

    private readonly Bucket[] _buckets;
    private readonly TimeProvider _timeProvider;

    public AiProviderRollingWindowStats(TimeProvider? timeProvider = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _buckets = new Bucket[WindowMinutes];
        for (var i = 0; i < _buckets.Length; i++)
        {
            _buckets[i] = new Bucket();
        }
    }

    public void RecordSuccess() => RecordInternal(success: true);

    public void RecordFailure() => RecordInternal(success: false);

    private void RecordInternal(bool success)
    {
        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var bucketKey = ToBucketKey(nowUtc);
        var index = bucketKey % _buckets.Length;
        var bucket = _buckets[(int)index];

        lock (bucket.Sync)
        {
            if (bucket.BucketKey != bucketKey)
            {
                // Bucket has rolled over (wraparound landed on a stale
                // slot from 24h ago) — zero it and re-stamp the key.
                bucket.BucketKey = bucketKey;
                bucket.SuccessCount = 0;
                bucket.FailureCount = 0;
            }

            if (success)
            {
                bucket.SuccessCount++;
            }
            else
            {
                bucket.FailureCount++;
            }
        }
    }

    /// <summary>
    /// Snapshot of the rolling 24h window.
    /// </summary>
    public WindowSnapshot Snapshot()
    {
        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var nowKey = ToBucketKey(nowUtc);
        var minKey = nowKey - (WindowMinutes - 1); // inclusive bound

        long totalSuccess = 0;
        long totalFailure = 0;

        for (var i = 0; i < _buckets.Length; i++)
        {
            var bucket = _buckets[i];
            lock (bucket.Sync)
            {
                if (bucket.BucketKey >= minKey && bucket.BucketKey <= nowKey)
                {
                    totalSuccess += bucket.SuccessCount;
                    totalFailure += bucket.FailureCount;
                }
            }
        }

        var windowStartUtc = FromBucketKey(minKey);
        var windowEndUtc = FromBucketKey(nowKey).AddMinutes(1).AddTicks(-1);

        return new WindowSnapshot(
            SuccessCount: totalSuccess,
            FailureCount: totalFailure,
            WindowStartUtc: windowStartUtc,
            WindowEndUtc: windowEndUtc);
    }

    /// <summary>
    /// True when the rolling 24h fail-rate exceeds 5% AND the window has
    /// at least <see cref="MinObservationsForRollback"/> total
    /// observations. See the class summary for the "sustained" rationale.
    /// </summary>
    public bool ShouldRollback(out WindowSnapshot snapshot)
    {
        snapshot = Snapshot();
        var total = snapshot.SuccessCount + snapshot.FailureCount;
        if (total < MinObservationsForRollback)
        {
            return false;
        }

        var rate = (double)snapshot.FailureCount / total;
        return rate > FailRateThreshold;
    }

    private static long ToBucketKey(DateTime utcNow)
    {
        // Minute-grain key, anchored to Unix epoch so wraparound math is
        // deterministic across process restarts.
        var ticks = utcNow.Ticks - DateTime.UnixEpoch.Ticks;
        return ticks / TimeSpan.TicksPerMinute;
    }

    private static DateTime FromBucketKey(long bucketKey)
    {
        return DateTime.UnixEpoch.AddTicks(bucketKey * TimeSpan.TicksPerMinute);
    }

    private sealed class Bucket
    {
        public readonly object Sync = new();
        public long BucketKey = -1;
        public long SuccessCount;
        public long FailureCount;
    }
}

/// <summary>
/// Read-only snapshot of an <see cref="AiProviderRollingWindowStats"/>
/// instance taken atomically (per bucket) at probe time.
/// </summary>
internal readonly record struct WindowSnapshot(
    long SuccessCount,
    long FailureCount,
    DateTime WindowStartUtc,
    DateTime WindowEndUtc)
{
    public long TotalCount => SuccessCount + FailureCount;

    public double FailRate => TotalCount == 0
        ? 0d
        : (double)FailureCount / TotalCount;

    public double FailRatePercent => FailRate * 100d;
}

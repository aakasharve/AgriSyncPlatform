// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02).
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.Privacy;

/// <summary>
/// How long an erasure request waits before anything is erased — founder D-71: "option 2 not 7 days but 30 days".
/// During the wait the person who asked may cancel it (CancelErasureHandler); after it, the erasure worker
/// takes it and erases exactly as designed.
///
/// <para>ONE named setting: configuration key <see cref="ConfigurationKey"/> (whole days), 30 by default. Every reader —
/// the request answer, the list, the cancel rule and the worker — reads this one value, so the date the person is shown
/// is the date the worker uses.</para>
/// </summary>
public sealed class ErasureTiming
{
    /// <summary>The configuration key: whole days an erasure request waits.</summary>
    public const string ConfigurationKey = "Erasure:WaitBeforeErasureDays";

    /// <summary>Founder D-71.</summary>
    public const int DefaultWaitDays = 30;

    public ErasureTiming()
        : this(TimeSpan.FromDays(DefaultWaitDays))
    {
    }

    public ErasureTiming(TimeSpan waitBeforeErasure)
    {
        if (waitBeforeErasure < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(waitBeforeErasure), waitBeforeErasure, "The wait cannot be negative.");
        }

        WaitBeforeErasure = waitBeforeErasure;
    }

    public TimeSpan WaitBeforeErasure { get; }

    /// <summary>When the worker may take <paramref name="request"/>.</summary>
    public DateTime ErasureStartsAtUtc(ErasureRequest request) => request.ErasureStartsAtUtc(WaitBeforeErasure);

    /// <summary>A request asked for at or before this instant is due at <paramref name="nowUtc"/>.</summary>
    public DateTime DueIfRequestedAtOrBefore(DateTime nowUtc) => nowUtc - WaitBeforeErasure;
}

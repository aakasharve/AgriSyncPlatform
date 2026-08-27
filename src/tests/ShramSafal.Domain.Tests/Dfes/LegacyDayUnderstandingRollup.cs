using ShramSafal.Domain.Dfes;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11. A VERBATIM copy of the Day Understanding
/// rollup deleted on 2026-08-13 — <c>DayUnderstandingScore.From(LensScores)</c>,
/// the arithmetic mean over whichever lenses happened to be applicable.
///
/// <para>It survives HERE, in the test assembly only, for one reason: the defect
/// it caused must stay provable. The mean's denominator shrank to whatever the
/// farmer had already mentioned, so telling the assistant MORE could score LESS —
/// the screen promises "tell me this and the number goes up" and the engine could
/// make that a lie. Tests that show the old number FALLING and the new one not
/// falling are the only tests that prove the fix is not vacuous.</para>
///
/// <para>Nothing in production may call this. If it ever comes back into
/// <c>ShramSafal.Domain</c>, the monotonicity suite goes red.</para>
/// </summary>
internal static class LegacyDayUnderstandingRollup
{
    public static int? MeanOverApplicableLenses(LensScores lenses)
    {
        var sum = 0;
        var applicable = 0;

        if (lenses.ExecutionScore is { } e) { sum += e; applicable++; }
        if (lenses.InsightScore is { } i) { sum += i; applicable++; }
        if (lenses.LearningScore is { } l) { sum += l; applicable++; }

        if (applicable == 0)
        {
            return null; // no applicable lens → no score (never a zero)
        }

        var mean = (double)sum / applicable;                                      // 0–100
        var rounded = (int)Math.Round(mean / 10.0, MidpointRounding.AwayFromZero); // 0–10
        return Math.Clamp(rounded, 0, 10);
    }
}

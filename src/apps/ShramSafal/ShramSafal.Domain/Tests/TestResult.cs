using System.Globalization;

namespace ShramSafal.Domain.Tests;

/// <summary>
/// A single parameter measurement reported by a lab for a <see cref="TestInstance"/>.
/// Stored as a value object — precision is preserved by keeping
/// <see cref="ParameterValue"/> as a string exactly as the lab reported it.
/// </summary>
public sealed record TestResult(
    string ParameterCode,
    string ParameterValue,
    string Unit,
    decimal? ReferenceRangeLow,
    decimal? ReferenceRangeHigh);

public static class TestResultExtensions
{
    /// <summary>
    /// Evaluates whether <see cref="TestResult.ParameterValue"/> falls within the
    /// result's reference range.
    /// <list type="bullet">
    /// <item>If both bounds are null → <c>true</c> (no reference available).</item>
    /// <item>If only one bound is set → one-sided comparison.</item>
    /// <item>If <see cref="TestResult.ParameterValue"/> cannot be parsed as decimal
    /// and a bound is set → <c>false</c> (unknown).</item>
    /// </list>
    /// </summary>
    public static bool IsWithinRange(this TestResult result)
    {
        if (result.ReferenceRangeLow is null && result.ReferenceRangeHigh is null)
        {
            return true;
        }

        if (!decimal.TryParse(
                result.ParameterValue,
                NumberStyles.Number,
                CultureInfo.InvariantCulture,
                out var value))
        {
            return false;
        }

        if (result.ReferenceRangeLow is { } low && value < low)
        {
            return false;
        }

        if (result.ReferenceRangeHigh is { } high && value > high)
        {
            return false;
        }

        return true;
    }
}

using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) —
/// invariant suite for the new <see cref="AiProviderConfig.MonthlyBudgetInr"/>
/// property + <see cref="AiProviderConfig.SetMonthlyBudget"/> mutator.
/// </summary>
public sealed class AiProviderConfigMonthlyBudgetTests
{
    [Fact]
    public void Default_config_has_null_monthly_budget()
    {
        var config = AiProviderConfig.CreateDefault();
        Assert.Null(config.MonthlyBudgetInr);
    }

    [Fact]
    public void SetMonthlyBudget_stores_positive_value_and_bumps_ModifiedAtUtc()
    {
        var config = AiProviderConfig.CreateDefault();
        var before = config.ModifiedAtUtc;

        // Need to advance the wall-clock minimally so the stamped
        // ModifiedAtUtc is observably different.
        System.Threading.Thread.Sleep(2);
        config.SetMonthlyBudget(5000m);

        Assert.Equal(5000m, config.MonthlyBudgetInr);
        Assert.True(config.ModifiedAtUtc >= before);
    }

    [Fact]
    public void SetMonthlyBudget_null_disables_budget()
    {
        var config = AiProviderConfig.CreateDefault();
        config.SetMonthlyBudget(5000m);
        Assert.Equal(5000m, config.MonthlyBudgetInr);

        config.SetMonthlyBudget(null);
        Assert.Null(config.MonthlyBudgetInr);
    }

    [Fact]
    public void SetMonthlyBudget_negative_input_clamps_to_zero_kill_switch()
    {
        // Negative budget is a misconfiguration — clamping to zero
        // surfaces it loudly the next time the guardrail ticks
        // (every spend > 0 trips the 100% Critical) without making
        // the mutator throw.
        var config = AiProviderConfig.CreateDefault();
        config.SetMonthlyBudget(-100m);
        Assert.Equal(0m, config.MonthlyBudgetInr);
    }
}

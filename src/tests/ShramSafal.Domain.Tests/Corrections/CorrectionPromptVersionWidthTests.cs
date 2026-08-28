// spec: correctionevent-server-persistence
using ShramSafal.Domain.Corrections;
using Xunit;

namespace ShramSafal.Domain.Tests.Corrections;

/// <summary>
/// ssf.correction_events.prompt_version was varchar(20) while the only producer
/// of that value emits 158 characters, so every correction that reached the
/// INSERT came back as Postgres 22001 -> DbUpdateException -> HTTP 500, and the
/// ledger held 0 rows for four months without anyone noticing.
///
/// <para>These tests pin the ARITHMETIC that made the bug inevitable. They are
/// deliberately dependency-free: the real-Postgres round-trip lives in the
/// integration suite, but the sizing decision itself must be defended somewhere
/// that runs on every single build.</para>
/// </summary>
public sealed class CorrectionPromptVersionWidthTests
{
    /// <summary>
    /// The exact shape AiPromptTemplateRegistry.BuildVersionString emits, with all
    /// eight required buckets at v1 — measured at 158 characters against the live
    /// prompt assets on 2026-08-28.
    /// </summary>
    private const string RealWorldPromptVersion =
        "base:v1;output:v1;buckets:workDone:v1,irrigation:v1,inputs:v1,labour:v1,"
        + "machinery:v1,expenses:v1,tasks:v1,observations:v1;disturbance:v1;hash:0123456789abcdef";

    /// <summary>The other branch of ResolvePromptVersion — 39 chars.</summary>
    private const string LegacyFallbackPromptVersion = "legacy-2026-02-22;hash:0123456789abcdef";

    [Fact]
    public void the_real_prompt_version_fits_the_declared_cap()
    {
        // Before the fix this was 158 > 20 and every correction 500'd.
        Assert.True(
            RealWorldPromptVersion.Length <= CorrectionEvent.PromptVersionMaxLength,
            $"prompt version is {RealWorldPromptVersion.Length} chars but the cap is "
            + $"{CorrectionEvent.PromptVersionMaxLength}. Every correction would be refused.");
    }

    [Fact]
    public void the_legacy_fallback_branch_fits_too()
    {
        Assert.True(LegacyFallbackPromptVersion.Length <= CorrectionEvent.PromptVersionMaxLength);
    }

    [Fact]
    public void the_cap_is_not_merely_sibling_sized()
    {
        // The trap this test exists to block: "correction_events(20) is the odd one
        // out, make it 32 or 64 like its siblings." The siblings store
        // Provenance.PromptVersion, which is hard-coded to the literal "v1". THIS
        // column stores the composite manifest. A 64 cap would look like a fix,
        // pass review, and still raise 22001 on every row.
        Assert.True(RealWorldPromptVersion.Length > 64,
            "If this ever fails the manifest shrank; re-derive the cap deliberately.");
        Assert.True(CorrectionEvent.PromptVersionMaxLength > RealWorldPromptVersion.Length,
            "The cap must leave headroom above today's exact value, not merely equal it.");
    }

    [Fact]
    public void there_is_headroom_for_two_digit_module_versions()
    {
        // 11 module slots; each going from vN to vNN adds one char.
        Assert.True(
            RealWorldPromptVersion.Length + 11 <= CorrectionEvent.PromptVersionMaxLength,
            "No room for the modules to reach two-digit versions without a second outage.");
    }

    [Fact]
    public void truncating_to_the_old_width_would_destroy_what_the_column_identifies()
    {
        // Why the handler REFUSES instead of truncating. The discriminating element
        // is the trailing hash; the prefix is byte-identical across every prompt
        // build ever shipped. A truncated value is a fabricated identifier (P4) in
        // the one table whose purpose is reconstructing which prompt ran (P10).
        var truncatedTo20 = RealWorldPromptVersion[..20];
        var otherBuild = RealWorldPromptVersion.Replace("hash:0123456789abcdef", "hash:fedcba9876543210");

        Assert.Equal(truncatedTo20, otherBuild[..20]);
        Assert.NotEqual(RealWorldPromptVersion, otherBuild);
    }
}

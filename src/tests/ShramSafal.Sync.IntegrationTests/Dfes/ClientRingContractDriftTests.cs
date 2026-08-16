// spec: dfes-companion-2026-07-11 (wave-1.3)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.3) — THE DRIFT GUARD THAT MAKES THE MIRROR
/// WORTH SOMETHING.
///
/// <para><b>The weakness this closes.</b> Wave-1.3's round-trip suite drives a C#
/// transcription of two client functions and concluded "the ring reads 100%". The
/// transcription was faithful on the day it was written — but a copy cannot detect
/// drift. Editing <c>mapVerificationStatus.ts</c> or <c>dayState.ts</c> would not have
/// failed a single backend test, so the claim was proven against the mirror, not
/// against the client.</para>
///
/// <para><b>What this does instead.</b> It reads the two REAL TypeScript files off
/// disk, extracts the mapping and the counted set from their source, and asserts the
/// mirror still agrees with both — case by case, in both directions. Change the
/// TypeScript and this suite goes red, naming the case that moved.</para>
///
/// <para><b>It never skips.</b> A missing file is a FAILURE, not a pass: a drift guard
/// that quietly disables itself when it cannot find its subject is the same lie in a
/// different costume. No database is touched, so it runs everywhere the suite runs.</para>
///
/// <para>This does not replace a TypeScript test of the client (that belongs in
/// mobile-web's own suite, outside the backend allowlist). It replaces the FALSE
/// CONFIDENCE of an unchecked copy.</para>
/// </summary>
public sealed class ClientRingContractDriftTests(Xunit.Abstractions.ITestOutputHelper output)
{
    [Fact]
    public void The_mirror_of_mapVerificationStatus_still_matches_the_TypeScript_it_copies()
    {
        var source = ReadClientSource(ClientRingContractMirror.MapVerificationStatusSourcePath);
        var cases = ParseSwitchCases(source);

        cases.Should().HaveCountGreaterThanOrEqualTo(8,
            "mapVerificationStatus.ts maps at least 8 wire strings today; parsing far fewer means " +
            "the file changed shape and this guard is no longer reading what it thinks it is");

        foreach (var (wireValue, expectedMember) in cases)
        {
            ClientRingContractMirror.MapVerificationStatus(wireValue).Should().Be(expectedMember,
                $"mapVerificationStatus.ts maps '{wireValue}' to LogVerificationStatus.{expectedMember}; " +
                "the C# mirror the round-trip suite drives has drifted from it");
            output.WriteLine($"[DRIFT-GUARD] '{wireValue}' -> {expectedMember} (mirror agrees)");
        }

        // The two the wave-1.3 round trip actually rides on, stated by name so a reader
        // of a failure knows immediately what broke.
        cases.Should().Contain(("verified", "VERIFIED"),
            "the server lands an owner's own log on Verified; if the client stops mapping " +
            "'verified' to VERIFIED, the farmer's ring re-opens on the next pull");
        cases.Should().Contain(("confirmed", "CONFIRMED"),
            "Confirmed must stay its own status — collapsing it into VERIFIED would award a " +
            "closed day for a log nobody has approved");

        // The empty/unknown fall-through, which the switch cannot express as a case.
        ClientRingContractMirror.MapVerificationStatus(null).Should().Be("DRAFT");
        ClientRingContractMirror.MapVerificationStatus("").Should().Be("DRAFT");
        ClientRingContractMirror.MapVerificationStatus("something-new-from-the-server").Should().Be("DRAFT");

        // The normalizer, not just the switch: the wire carries PascalCase ("Verified"),
        // the switch matches snake_case. A change to either regex breaks the round trip.
        ClientRingContractMirror.MapVerificationStatus("Verified").Should().Be("VERIFIED");
        ClientRingContractMirror.MapVerificationStatus("CorrectionPending").Should().Be("CORRECTION_PENDING");
        source.Should().Contain("replace(/([a-z])([A-Z])/g, '$1_$2')",
            "the PascalCase-to-snake_case normalizer is what lets the server's 'Verified' hit " +
            "the switch's 'verified' case at all");
    }

    [Fact]
    public void The_mirror_of_the_rings_counted_set_still_matches_dayState_ts()
    {
        var source = ReadClientSource(ClientRingContractMirror.DayStateSourcePath);
        var counted = ParseVerifiedStatuses(source);

        counted.Should().NotBeEmpty("VERIFIED_STATUSES could not be parsed out of dayState.ts");
        output.WriteLine($"[DRIFT-GUARD] dayState.ts VERIFIED_STATUSES = {{{string.Join(", ", counted)}}}");

        // Both directions. Every status the client knows about is checked against the
        // mirror, so an ADDITION to the set (e.g. someone adds CONFIRMED) fails just as
        // loudly as a removal.
        var everyStatus = new[]
        {
            "DRAFT", "CONFIRMED", "VERIFIED", "APPROVED", "DISPUTED", "CORRECTION_PENDING"
        };

        foreach (var status in everyStatus)
        {
            ClientRingContractMirror.TheRingCountsIt(status).Should().Be(counted.Contains(status),
                $"dayState.ts {(counted.Contains(status) ? "counts" : "does not count")} {status}; " +
                "the C# mirror the round-trip suite drives disagrees");
        }

        counted.Should().Contain("VERIFIED",
            "this is the whole wave-1.3 fix: the server lands the owner's log on Verified " +
            "precisely because the ring already counts VERIFIED");
        counted.Should().NotContain("CONFIRMED",
            "ReviewInboxSheet.tsx:40-45 lists a CONFIRMED log as still awaiting review — if the " +
            "ring counted it too, two screens would disagree about the same log");
    }

    // ── Parsing the client source ────────────────────────────────────────────

    /// <summary>
    /// Reads a repo-root-relative client file. Walks up from the test assembly until it
    /// finds the file. FAILS (never skips) when it cannot — the point of this suite is
    /// that it cannot quietly stop guarding.
    /// </summary>
    private static string ReadClientSource(string repoRelativePath)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, repoRelativePath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(candidate))
            {
                return File.ReadAllText(candidate);
            }

            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            $"Could not find '{repoRelativePath}' walking up from '{AppContext.BaseDirectory}'. " +
            "This guard exists to keep a C# mirror honest against the real client source; if the " +
            "file moved, RE-POINT the guard — do not delete it, or the round-trip suite silently " +
            "goes back to proving things against a copy of itself.",
            repoRelativePath);
    }

    /// <summary>
    /// Pulls <c>case 'x': ... return LogVerificationStatus.Y;</c> pairs out of the
    /// TypeScript switch. Labels accumulate until a return is seen, so fall-through
    /// groups (<c>case 'approved': case 'verified':</c>) map to the same member.
    /// </summary>
    private static List<(string WireValue, string Member)> ParseSwitchCases(string source)
    {
        var pairs = new List<(string, string)>();
        var pending = new List<string>();

        foreach (var raw in source.Split('\n'))
        {
            var line = raw.Trim();

            var caseMatch = Regex.Match(line, @"^case\s+'([^']+)'\s*:$");
            if (caseMatch.Success)
            {
                pending.Add(caseMatch.Groups[1].Value);
                continue;
            }

            var returnMatch = Regex.Match(line, @"^return\s+LogVerificationStatus\.([A-Z_]+)\s*;$");
            if (returnMatch.Success && pending.Count > 0)
            {
                foreach (var label in pending)
                {
                    pairs.Add((label, returnMatch.Groups[1].Value));
                }

                pending.Clear();
            }
        }

        return pairs;
    }

    /// <summary>
    /// Pulls the member names out of
    /// <c>const VERIFIED_STATUSES = new Set&lt;LogVerificationStatus&gt;([ ... ]);</c>.
    /// </summary>
    private static HashSet<string> ParseVerifiedStatuses(string source)
    {
        var block = Regex.Match(
            source,
            @"VERIFIED_STATUSES\s*=\s*new\s+Set<LogVerificationStatus>\(\s*\[(?<body>[^\]]*)\]",
            RegexOptions.Singleline);

        if (!block.Success)
        {
            throw new InvalidOperationException(
                "VERIFIED_STATUSES could not be located in dayState.ts. Re-point this guard rather " +
                "than removing it — the round-trip suite's ring assertion depends on it.");
        }

        return Regex.Matches(block.Groups["body"].Value, @"LogVerificationStatus\.([A-Z_]+)")
            .Select(m => m.Groups[1].Value)
            .ToHashSet();
    }
}

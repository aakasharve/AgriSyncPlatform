using System.Reflection;
using System.Text.RegularExpressions;
using FluentAssertions;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.8 — architectural lock
/// on the founder Q2 decision recorded in Y.md §8.
///
/// The sync wire payload stays <b>batch-level</b>: the app version that
/// produced a mutation flows in on <c>PushSyncBatchCommand.AppVersion</c>,
/// NOT on a per-mutation <c>appVersion</c> / <c>clientAppVersion</c> field
/// inside <c>mutation-types.json</c> or any individual payload Zod schema.
/// The .NET application command types <em>do</em> own a
/// <c>ClientAppVersion</c> string (lifted from the <c>X-App-Version</c>
/// header at the endpoint), but that is a server-side command field —
/// never a wire-contract field.
///
/// If a future change adds <c>appVersion</c> on a mutation payload, the
/// data principle splits (two sources of truth for the same fact) and
/// Provenance.AppVersion can drift between the batch header and the
/// row. This test prevents that drift.
/// </summary>
public sealed class MutationContractIsBatchLevelOnly
{
    private static readonly Regex AppVersionWord = new(
        @"\b(appVersion|clientAppVersion)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex BlockCommentStripper = new(
        @"/\*.*?\*/",
        RegexOptions.Singleline | RegexOptions.Compiled);

    [Fact]
    public void MutationTypesJson_DoesNotMentionAppVersionField()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var mutationTypesPath = Path.GetFullPath(
            Path.Combine(solutionRoot, "..", "sync-contract", "schemas", "mutation-types.json"));

        File.Exists(mutationTypesPath).Should().BeTrue(
            $"sync-contract/schemas/mutation-types.json must exist at {mutationTypesPath}");

        var raw = File.ReadAllText(mutationTypesPath);
        var stripped = StripComments(raw);

        AppVersionWord.IsMatch(stripped).Should().BeFalse(
            "DATA_PRINCIPLE_SPINE Y.md §8 lock — mutation-types.json must not "
            + "declare per-mutation appVersion field. Sync app version lives at "
            + "the batch level (PushSyncBatchCommand.AppVersion).");
    }

    [Fact]
    public void PayloadZodSchemas_DoNotDeclareAppVersionField()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var payloadsDir = Path.GetFullPath(
            Path.Combine(solutionRoot, "..", "sync-contract", "schemas", "payloads"));

        Directory.Exists(payloadsDir).Should().BeTrue(
            $"sync-contract/schemas/payloads must exist at {payloadsDir}");

        var zodFiles = Directory.GetFiles(payloadsDir, "*.zod.ts", SearchOption.TopDirectoryOnly);
        zodFiles.Should().NotBeEmpty(
            "expected at least one *.zod.ts payload schema under sync-contract/schemas/payloads");

        var offenders = new List<string>();

        foreach (var file in zodFiles)
        {
            var lines = File.ReadAllLines(file);
            // Strip C++-style single-line comments before scanning so that
            // a comment like "// no appVersion here — see Y.md §8" does
            // not trigger a false positive.
            var nonCommentLines = lines
                .Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal));
            var joined = string.Join('\n', nonCommentLines);
            // Also strip block comments before scanning.
            var stripped = BlockCommentStripper.Replace(joined, string.Empty);

            if (AppVersionWord.IsMatch(stripped))
            {
                offenders.Add(Path.GetFileName(file));
            }
        }

        offenders.Should().BeEmpty(
            "DATA_PRINCIPLE_SPINE Y.md §8 lock — no per-mutation payload Zod "
            + "schema may declare an appVersion / clientAppVersion field. "
            + "Sync app version lives at the batch level "
            + "(PushSyncBatchCommand.AppVersion). Offending file(s): "
            + string.Join(", ", offenders));
    }

    [Fact]
    public void CreateDailyLogCommand_And_AddCostEntryCommand_Expose_ClientAppVersion()
    {
        // Locks the other half of the Q2 decision: ClientAppVersion belongs
        // ON THE COMMAND (lifted from the X-App-Version header at the
        // endpoint and stamped onto Provenance.AppVersion), not on the
        // wire payload.
        AssertCommandExposesClientAppVersion(typeof(CreateDailyLogCommand));
        AssertCommandExposesClientAppVersion(typeof(AddCostEntryCommand));
    }

    private static void AssertCommandExposesClientAppVersion(Type commandType)
    {
        var property = commandType.GetProperty(
            "ClientAppVersion",
            BindingFlags.Public | BindingFlags.Instance);

        property.Should().NotBeNull(
            $"DATA_PRINCIPLE_SPINE Y.md §8 lock — {commandType.FullName} must "
            + "expose a public 'ClientAppVersion' property. The X-App-Version "
            + "header captured at the endpoint flows into this command field "
            + "and is stamped onto Provenance.AppVersion.");

        property!.PropertyType.Should().Be(
            typeof(string),
            $"DATA_PRINCIPLE_SPINE Y.md §8 lock — {commandType.FullName}.ClientAppVersion "
            + "must be typed 'string' (matches Provenance.AppVersion).");
    }

    private static string StripComments(string raw)
    {
        // Strip C-style block comments first (defensive — the file is
        // plain JSON today but the brief explicitly says "strip block
        // comments if present" so we honor JSON-with-comments format).
        var withoutBlocks = BlockCommentStripper.Replace(raw, string.Empty);

        // Then strip C++-style single-line comments.
        var nonCommentLines = withoutBlocks
            .Split('\n')
            .Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal));

        return string.Join('\n', nonCommentLines);
    }
}

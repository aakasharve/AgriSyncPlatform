// spec: data-principle-spine-2026-05-05/05.4
using System.Text.Json;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.4 — companion architecture
/// test for <see cref="AgriSync.BuildingBlocks.Security.RegionGuard"/>.
/// Parses the production <c>appsettings.json</c> JSON tree and asserts
/// that every key whose name contains <c>"egion"</c> (case-insensitive
/// — catches both <c>Region</c> and <c>region</c>) has the value
/// <see cref="AgriSync.BuildingBlocks.Security.RegionGuard.RequiredRegion"/>.
///
/// <para>
/// <b>Why parse JSON, not <see cref="Microsoft.Extensions.Configuration"/>.</b>
/// We want the test to fire on the as-checked-in file shape — not on a
/// merged configuration tree that includes env vars + Secrets Manager
/// overrides. A literal text scan of <c>appsettings.json</c> catches
/// "someone committed us-east-1 by accident"; the runtime
/// <see cref="AgriSync.BuildingBlocks.Security.RegionGuard.AssertApSouth1"/>
/// guard handles env-var / Secrets Manager overrides at boot.
/// </para>
///
/// <para>
/// <b>OQ-3 verdict alignment.</b> Null/empty values are skipped per the
/// same warn-on-missing policy the runtime guard follows — the
/// architecture test only fails on a non-matching non-empty value. The
/// envelope's "Open question" picked option (a): bake the production-
/// correct default into <c>appsettings.json</c> so the test exercises
/// the throw-on-mismatch branch by default (the file has
/// <c>"AWS:Region": "ap-south-1"</c> — assertion passes; a deliberate
/// override to anything else would fail this test before it ever
/// reached production).
/// </para>
/// </summary>
public sealed class RegionPinningRules
{
    [Fact]
    public void All_region_keys_in_appsettings_are_ap_south_1()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var path = Path.Combine(solutionRoot, "AgriSync.Bootstrapper", "appsettings.json");
        Assert.True(File.Exists(path), $"appsettings.json not found at {path}.");

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var hits = new List<(string key, string value)>();
        Walk(doc.RootElement, "", hits);

        var regionHits = hits
            .Where(h => h.key.Contains("egion", StringComparison.OrdinalIgnoreCase))
            // Skip null/empty per the runtime guard's warn-on-missing
            // policy (OQ-3). The architecture test only fires on
            // accidentally-checked-in non-empty mismatches.
            .Where(h => !string.IsNullOrWhiteSpace(h.value))
            .ToList();

        var violations = regionHits
            .Where(h => h.value != AgriSync.BuildingBlocks.Security.RegionGuard.RequiredRegion)
            .ToList();

        Assert.True(
            violations.Count == 0,
            "appsettings.json keys containing 'egion' (case-insensitive) must equal "
                + $"'{AgriSync.BuildingBlocks.Security.RegionGuard.RequiredRegion}'. Violations: "
                + string.Join(", ", violations.Select(v => $"{v.key}='{v.value}'")));
    }

    /// <summary>
    /// Depth-first walk of every leaf string property in the JSON tree.
    /// Captures <c>(dotted-key-path, string-value)</c> pairs into
    /// <paramref name="hits"/>. Non-string leaves are ignored — a
    /// non-string Region value would already fail strong-typed
    /// configuration binding so the architecture test would never see
    /// it anyway.
    /// </summary>
    private static void Walk(JsonElement element, string keyPath, List<(string key, string value)> hits)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in element.EnumerateObject())
                {
                    var nextPath = string.IsNullOrEmpty(keyPath)
                        ? prop.Name
                        : $"{keyPath}.{prop.Name}";
                    Walk(prop.Value, nextPath, hits);
                }
                break;

            case JsonValueKind.Array:
                var idx = 0;
                foreach (var item in element.EnumerateArray())
                {
                    Walk(item, $"{keyPath}[{idx++}]", hits);
                }
                break;

            case JsonValueKind.String:
                hits.Add((keyPath, element.GetString() ?? string.Empty));
                break;
        }
    }
}

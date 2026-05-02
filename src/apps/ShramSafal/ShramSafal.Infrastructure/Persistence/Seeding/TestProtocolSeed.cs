using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Seeding;

/// <summary>
/// CEI Phase 3 §4.5 — bootstrap the four canonical Grapes test protocols so
/// <c>ScheduleTestDueDates</c> has a default working set when the farm is
/// first onboarded.
/// <para>
/// The seeder is idempotent: rows are matched by <c>(name, crop_type)</c>
/// case-insensitively. Re-running the seeder on an already-seeded DB is a
/// no-op. Attach to the startup pipeline behind
/// <c>SEED_TEST_PROTOCOLS_V1=true</c>.
/// </para>
/// </summary>
public sealed class TestProtocolSeed
{
    /// <summary>Stable user id used as <c>CreatedByUserId</c> for system-seeded protocols.</summary>
    private static readonly UserId SystemUserId = new(Guid.Parse("00000000-0000-0000-0000-000000000099"));

    /// <summary>Stable protocol ids so re-seeding reproduces the same row identities.</summary>
    private static readonly Guid SoilBasicId = Guid.Parse("a1000000-0000-0000-0000-000000000001");
    private static readonly Guid PetioleMonthlyId = Guid.Parse("a1000000-0000-0000-0000-000000000002");
    private static readonly Guid ResiduePreHarvestId = Guid.Parse("a1000000-0000-0000-0000-000000000003");
    private static readonly Guid DrainagePreCycleId = Guid.Parse("a1000000-0000-0000-0000-000000000004");

    private const string GrapesCrop = "Grapes";

    public static readonly IReadOnlyList<SeedSpec> All =
    [
        new SeedSpec(
            Id: SoilBasicId,
            Name: "Soil basic",
            CropType: GrapesCrop,
            Kind: TestProtocolKind.Soil,
            Periodicity: TestProtocolPeriodicity.OneTime,
            EveryNDays: null,
            StageNames: ["Pre-plantation"],
            ParameterCodes: ["pH", "N", "P", "K", "OC"]),

        new SeedSpec(
            Id: PetioleMonthlyId,
            Name: "Petiole monthly",
            CropType: GrapesCrop,
            Kind: TestProtocolKind.Petiole,
            Periodicity: TestProtocolPeriodicity.EveryNDays,
            EveryNDays: 30,
            StageNames: ["Vegetative", "Flowering", "Fruit set", "Veraison"],
            ParameterCodes: ["N", "P", "K", "Ca", "Mg"]),

        new SeedSpec(
            Id: ResiduePreHarvestId,
            Name: "Residue pre-harvest",
            CropType: GrapesCrop,
            Kind: TestProtocolKind.Residue,
            Periodicity: TestProtocolPeriodicity.OneTime,
            EveryNDays: null,
            StageNames: ["Harvest"],
            ParameterCodes: ["residue.level"]),

        new SeedSpec(
            Id: DrainagePreCycleId,
            Name: "Drainage pre-cycle",
            CropType: GrapesCrop,
            Kind: TestProtocolKind.Drainage,
            Periodicity: TestProtocolPeriodicity.OneTime,
            EveryNDays: null,
            StageNames: ["Pre-plantation"],
            ParameterCodes: ["infiltration.rate", "waterTable.depth"])
    ];

    private readonly ShramSafalDbContext _context;
    private readonly ILogger<TestProtocolSeed>? _logger;

    public TestProtocolSeed(ShramSafalDbContext context, ILogger<TestProtocolSeed>? logger = null)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
        _logger = logger;
    }

    /// <summary>
    /// Upserts the four canonical Grapes protocols. Returns the number of
    /// rows newly added (already-present rows are skipped).
    /// </summary>
    public async Task<int> SeedAsync(DateTime nowUtc, CancellationToken ct = default)
    {
        // Idempotency check — fetch any existing rows matching our seed (name, crop_type).
        var seedNames = All.Select(s => s.Name).ToArray();
        var existing = await _context.TestProtocols
            .Where(p => p.CropType == GrapesCrop && seedNames.Contains(p.Name))
            .Select(p => new { p.Name, p.CropType })
            .ToListAsync(ct);

        var existingKeys = existing
            .Select(e => BuildKey(e.Name, e.CropType))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var added = 0;
        foreach (var seed in All)
        {
            var key = BuildKey(seed.Name, seed.CropType);
            if (existingKeys.Contains(key))
            {
                continue;
            }

            var protocol = TestProtocol.Create(
                id: seed.Id,
                name: seed.Name,
                cropType: seed.CropType,
                kind: seed.Kind,
                periodicity: seed.Periodicity,
                createdByUserId: SystemUserId,
                createdAtUtc: nowUtc,
                everyNDays: seed.EveryNDays);

            foreach (var stage in seed.StageNames)
            {
                protocol.AttachToStage(stage);
            }

            foreach (var paramCode in seed.ParameterCodes)
            {
                protocol.AddParameterCode(paramCode);
            }

            await _context.TestProtocols.AddAsync(protocol, ct);
            added++;
        }

        if (added > 0)
        {
            await _context.SaveChangesAsync(ct);
            _logger?.LogInformation("Seeded {Count} default test protocols (Grapes).", added);
        }
        else
        {
            _logger?.LogInformation("Default test protocols already present — skipping.");
        }

        return added;
    }

    private static string BuildKey(string name, string cropType) =>
        $"{name.Trim().ToLowerInvariant()}|{cropType.Trim().ToLowerInvariant()}";

    public sealed record SeedSpec(
        Guid Id,
        string Name,
        string CropType,
        TestProtocolKind Kind,
        TestProtocolPeriodicity Periodicity,
        int? EveryNDays,
        IReadOnlyList<string> StageNames,
        IReadOnlyList<string> ParameterCodes);
}

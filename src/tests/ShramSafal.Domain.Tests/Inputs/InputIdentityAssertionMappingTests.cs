// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 1)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using ShramSafal.Domain.Inputs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// What the model says about <c>ssf.input_identity_assertions</c>, and the SQL its reads become - both read WITHOUT a database
/// (the context is built over a connection that is never opened: <c>ToQueryString</c> and the model do not connect). The
/// privilege and row-policy proofs need a real Postgres and are <c>InputIdentityAssertionsRealPostgresTests</c>.
/// </summary>
public sealed class InputIdentityAssertionMappingTests
{
    private static ShramSafalDbContext NewOfflineContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=offline;Username=offline;Password=offline;Timeout=1")
            .Options);

    // The design-time model: it keeps what a migration needs (check constraints, index sort order) that the runtime model drops.
    private static IEntityType Entity(ShramSafalDbContext db) =>
        db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(InputIdentityAssertion))!;

    [Fact]
    public void TheTable_IsInTheSsfSchema_WithTheColumnsTheMigrationCreates()
    {
        using var db = NewOfflineContext();
        var entity = Entity(db);

        Assert.Equal("input_identity_assertions", entity.GetTableName());
        Assert.Equal("ssf", entity.GetSchema());
        var columns = entity.GetProperties().Select(p => p.GetColumnName()).OrderBy(c => c, StringComparer.Ordinal).ToArray();
        Assert.Equal(
            new[]
            {
                "Id", "asserted_at_utc", "asserted_by_user_id", "attachment_id", "catalog_product_id", "catalog_version",
                "client_mutation_id", "daily_log_id", "farm_id", "input_event_id", "is_check", "mix_index", "plot_id",
                "spoken_name", "verdict",
            }.OrderBy(c => c, StringComparer.Ordinal).ToArray(),
            columns);
    }

    [Fact]
    public void ARepeatedSyncRequest_OnTheSameFarm_IsTheSameRow_ByAUniqueKey()
    {
        using var db = NewOfflineContext();
        var unique = Assert.Single(Entity(db).GetIndexes(), i => i.IsUnique);

        Assert.Equal(new[] { "farm_id", "client_mutation_id" }, unique.Properties.Select(p => p.GetColumnName()).ToArray());
        Assert.Equal("ux_input_identity_assertions_farm_mutation", unique.GetDatabaseName());
    }

    [Fact]
    public void TheNewestAnswerOfAnItem_HasItsOwnIndex_NewestFirst()
    {
        using var db = NewOfflineContext();
        var item = Entity(db).GetIndexes().Single(i => i.GetDatabaseName() == "ix_input_identity_assertions_item_asserted");

        Assert.Equal(
            new[] { "daily_log_id", "input_event_id", "mix_index", "asserted_at_utc" },
            item.Properties.Select(p => p.GetColumnName()).ToArray());
        Assert.Equal(new[] { false, false, false, true }, item.IsDescending);
    }

    [Fact]
    public void TheTableKeepsOnlyKnownAnswers_AConfirmedOneNamesItsProduct_AndNoNegativeSlot()
    {
        using var db = NewOfflineContext();
        var checks = Entity(db).GetCheckConstraints().ToDictionary(c => c.Name!, c => c.Sql);

        Assert.Equal("verdict IN ('confirmed', 'rejected', 'photo')", checks["ck_input_identity_assertions_verdict"]);
        Assert.Equal("verdict <> 'confirmed' OR catalog_product_id IS NOT NULL", checks["ck_input_identity_assertions_confirmed_has_product"]);
        Assert.Equal("mix_index >= 0", checks["ck_input_identity_assertions_mix_index"]);
    }

    [Fact]
    public void TheRecordKeyIsNotAForeignKey_SoADemoClearOrFixtureResetNeverFailsOnIt()
    {
        using var db = NewOfflineContext();
        var foreignKeys = Entity(db).GetForeignKeys().Select(k => k.PrincipalEntityType.GetTableName()).ToArray();

        Assert.Equal(new[] { "farms" }, foreignKeys);
    }

    [Fact]
    public void TheVerdict_IsStoredAsItsLowerCaseWireWord()
    {
        using var db = NewOfflineContext();
        var converter = Entity(db).FindProperty(nameof(InputIdentityAssertion.Verdict))!.GetValueConverter()!;

        Assert.Equal("confirmed", converter.ConvertToProvider(IdentityVerdict.Confirmed));
        Assert.Equal("photo", converter.ConvertToProvider(IdentityVerdict.Photo));
        Assert.Equal(IdentityVerdict.Rejected, converter.ConvertFromProvider("rejected"));
        Assert.Throws<InvalidOperationException>(() => converter.ConvertFromProvider("maybe"));
    }

    [Fact]
    public void TheRepositorysNewestAnswersQuery_TranslatesToSql_AndChecksTheRecordsOwnFarmBeforePickingTheNewest()
    {
        // NewestLegitimateAssertions IS the query the repository member runs (internal, so it can be read without a database).
        using var db = NewOfflineContext();

        var sql = ShramSafalRepository.NewestLegitimateAssertions(db, [Guid.NewGuid(), Guid.NewGuid()]).ToQueryString();

        Assert.Contains("input_identity_assertions", sql);
        Assert.Contains("daily_logs", sql);
        Assert.Contains("farm_id", sql);
        Assert.Contains("asserted_at_utc", sql);
        Assert.Contains("ROW_NUMBER", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AQueryOfTheDeltasShape_TranslatesToSqlWithItsFarmAndCursorFilters_ItIsNotTheRepositoryMember()
    {
        // This builds ITS OWN query of the same shape as GetInputIdentityAssertionsChangedSinceAsync and reads its SQL: it shows
        // the shape translates. It does NOT run the repository member - that is InputIdentityAssertionRepositoryInMemoryTests
        // (Sync.IntegrationTests; the real repository over EF's in-memory provider) and the real-Postgres facts.
        using var db = NewOfflineContext();
        var farms = new List<AgriSync.SharedKernel.Contracts.Ids.FarmId> { new(Guid.NewGuid()) };

        var sql = db.InputIdentityAssertions
            .AsNoTracking()
            .Where(a => farms.Contains(a.FarmId) && a.AssertedAtUtc > new DateTime(2026, 11, 8, 0, 0, 0, DateTimeKind.Utc))
            .OrderBy(a => a.AssertedAtUtc)
            .ToQueryString();

        Assert.Contains("farm_id", sql);
        Assert.Contains("asserted_at_utc >", sql);
    }
}

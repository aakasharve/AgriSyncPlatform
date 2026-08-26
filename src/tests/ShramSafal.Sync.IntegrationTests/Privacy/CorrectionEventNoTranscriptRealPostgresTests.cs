// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.4
using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Domain.Corrections;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// §P0.4 — <c>ssf.correction_events</c> against REAL Postgres.
///
/// <para>
/// <b>Why this needs a real database and not the in-memory harness.</b> The
/// physical table is created by raw SQL (<c>20260504010000_AddCorrectionEvent</c>)
/// with snake_case columns; the EF configuration never said so and the context
/// has no snake_case convention, so the model addressed <c>"UserId"</c>,
/// <c>"OriginalParseRaw"</c> and friends — columns that do not exist. Every
/// insert threw <c>42703</c>. An in-memory provider invents whatever columns
/// the model names and would have reported this as working for as long as it
/// stayed broken. Only real Npgsql can tell the difference.
/// </para>
///
/// <para>
/// Two proofs, and they pull against each other on purpose:
/// <list type="number">
///   <item>a correction round-trips through the real table with NO verbatim
///         speech in either jsonb payload;</item>
///   <item>the structured correction signal — which field, what the AI said,
///         what the farmer said instead — is still there. It is the AI
///         learning loop's only input and it has no other home, so a
///         redaction that took it would be a data loss, not a fix.</item>
/// </list>
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class CorrectionEventNoTranscriptRealPostgresTests : IAsyncLifetime
{
    /// <summary>What a farmer said. Two worker names are inside it.</summary>
    private const string Spoken = "आज रामू आणि सीता यांनी चार तास काम केले";
    private const string Chunk = "रामू आणि सीता";

    private const string AiDraftJson = $$"""
    {
      "fullTranscript": "{{Spoken}}",
      "english": "Today Ramu and Sita worked four hours",
      "labour": [ { "maleCount": 2, "femaleCount": 0, "hoursWorked": 4, "sourceText": "{{Chunk}}" } ]
    }
    """;

    private const string FarmerDraftJson = $$"""
    {
      "fullTranscript": "{{Spoken}}",
      "labour": [ { "maleCount": 1, "femaleCount": 1, "hoursWorked": 4 } ]
    }
    """;

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_p04_corrections_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn)
        {
            Database = _scratchDbName,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    private ShramSafalDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_superuserConn)
            .Options;
        return new ShramSafalDbContext(options);
    }

    [Fact]
    public async Task A_correction_persists_through_the_real_table_and_carries_no_transcript()
    {
        var correction = CorrectionEvent.Record(
            userId: Guid.NewGuid(),
            originalParseId: Guid.NewGuid(),
            originalParseRaw: AiDraftJson,
            correctedParse: FarmerDraftJson,
            promptVersion: "v42",
            locale: "mr-IN",
            trigger: CorrectionTrigger.EditUI,
            promptContentHash: new string('b', 64));

        await using (var write = NewContext())
        {
            write.CorrectionEvents.Add(correction);
            // Before the mapping was corrected this threw
            // 42703 "column c.UserId does not exist".
            await write.SaveChangesAsync();
        }

        // Read the raw columns back, not the entity — the entity would show
        // us the model's view of the world, which is the thing under test.
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var read = raw.CreateCommand();
        read.CommandText = """
            SELECT original_parse_raw::text, corrected_parse::text,
                   prompt_content_hash, original_parse_id
              FROM ssf.correction_events
             WHERE "Id" = @id
            """;
        read.Parameters.AddWithValue("id", correction.Id);

        await using var reader = await read.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the correction must have persisted");

        var storedAi = reader.GetString(0);
        var storedFarmer = reader.GetString(1);

        storedAi.Should().NotContain(Spoken);
        storedAi.Should().NotContain(Chunk);
        storedAi.Should().NotContain("Ramu");
        storedFarmer.Should().NotContain(Spoken);
        TranscriptRedaction.ContainsTranscriptText(storedAi).Should().BeFalse();
        TranscriptRedaction.ContainsTranscriptText(storedFarmer).Should().BeFalse();

        // …and the disagreement the row exists to record is intact.
        storedAi.Should().Contain("\"maleCount\": 2");
        storedFarmer.Should().Contain("\"femaleCount\": 1");

        // The tamper-evident prompt identifier survived the round trip.
        reader.GetString(2).Should().Be(new string('b', 64));
        reader.IsDBNull(3).Should().BeFalse();
    }

    [Fact]
    public async Task A_correction_with_no_known_originating_job_persists_with_a_null_parse_id()
    {
        // The client used to mint a fresh random UUID here, which matched no
        // AiJob while still looking like a genuine link. NULL is the honest
        // value, and the column has to accept it.
        var correction = CorrectionEvent.Record(
            userId: Guid.NewGuid(),
            originalParseId: null,
            originalParseRaw: AiDraftJson,
            correctedParse: FarmerDraftJson,
            promptVersion: "v42",
            locale: "mr-IN",
            trigger: CorrectionTrigger.EditUI);

        await using (var write = NewContext())
        {
            write.CorrectionEvents.Add(correction);
            await write.SaveChangesAsync();
        }

        await using var verify = NewContext();
        var reloaded = await verify.CorrectionEvents
            .AsNoTracking()
            .SingleAsync(c => c.Id == correction.Id);

        reloaded.OriginalParseId.Should().BeNull();
        reloaded.PromptContentHash.Should().BeNull();
        TranscriptRedaction.ContainsTranscriptText(reloaded.OriginalParseRaw).Should().BeFalse();
    }
}

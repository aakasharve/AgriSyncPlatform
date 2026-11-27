// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1; P6)
// ERASURE PROVEN THROUGH THE WHOLE WORKER (a new erasure step once passed its own tests and made EVERY erasure end Failed in the real worker).
// The real ErasureWorker, through the real service provider, erases a person who saved his own identity card: the request reaches Completed, his
// card (public.user_identity_profiles) is gone, another person's card is untouched, a second pass changes nothing, and the per-table audit row
// names the table with "deleted". And the EXPORT: his card, every column, in /identity_profile.json; a person with no card gets "card": null.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWorkerPersonIdentityRealPostgresTests : IAsyncLifetime
{
    private static readonly Guid Erased = Guid.Parse("1de00000-0000-4000-8000-000000000001");
    private static readonly Guid Other = Guid.Parse("1de00000-0000-4000-8000-000000000002");
    private static readonly Guid NoCard = Guid.Parse("1de00000-0000-4000-8000-000000000003");

    private readonly Planning.ScheduleTaskDb _db = new();
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        await _db.InitializeAsync();
        await using (var raw = new NpgsqlConnection(_db.SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
                VALUES (@erased, '6100003001', 'पूर्वेश आरवे', 'x', NOW(), NOW(), TRUE, 0, 'mr'),
                       (@other, '6100003002', 'सुनील जाधव', 'x', NOW(), NOW(), TRUE, 0, 'mr'),
                       (@nocard, '6100003003', 'रमेश', 'x', NOW(), NOW(), TRUE, 0, 'mr');
                INSERT INTO public.user_identity_profiles
                    (user_id, version, name_mr, name_mr_basis, name_en, name_en_basis, farmer_id, farmer_id_status,
                     village_lgd_code, village_name_mr, village_name_en, village_basis, taluka_lgd_code, taluka_name_en, taluka_basis,
                     district_lgd_code, district_name_mr, district_name_en, district_basis, place_list_version, pin_code, pin_basis,
                     updated_at_utc, updated_app_version)
                VALUES (@erased, 3, 'पूर्वेश आरवे', 1, 'Purvesh Arve', 2, '12345678901', 0,
                        944182, 'पंढरपूर', 'Pandharpur', 1, 4249, 'Pandharpur', 1, 496, 'सोलापूर', 'Solapur', 1, 'lgd-mh-2026-11-26', '413304', 2,
                        NOW(), '1.0.19'),
                       (@other, 1, 'सुनील जाधव', 1, NULL, NULL, NULL, 0,
                        NULL, 'माझी वाडी', NULL, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW(), NULL);
                """, ("erased", Erased), ("other", Other), ("nocard", NoCard));
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _db.SuperuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _db.SuperuserConn,
                ["ConnectionStrings:UserDb"] = _db.SuperuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_provider is not null)
        {
            await _provider.DisposeAsync();
        }

        await _db.DisposeAsync();
    }

    [Fact]
    public async Task Erasing_him_completes_deletes_his_card_leaves_anothers_and_a_second_pass_changes_nothing()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var others = await CardAsync(raw, Other);
        others.Should().NotBeNull("arrange: another person has a card");
        (await CardAsync(raw, Erased)).Should().NotBeNull("arrange: his card is really there");

        var first = await RunOneErasurePassAsync(raw, Erased);

        (await CardAsync(raw, Erased)).Should().BeNull("his card is deleted whole (P6: everything on it is what he typed about himself)");
        (await CardAsync(raw, Other)).Should().Be(others, "another person's card is untouched");
        var audit = (string?)await ScalarAsync(raw, """
            SELECT payload FROM ssf.audit_events
            WHERE entity_type = 'ErasureAnonymize' AND payload::jsonb->>'requestId' = @r AND payload::jsonb->>'table' = 'user_identity_profiles'
            """, ("r", first.ToString()));
        audit.Should().NotBeNull("the per-table audit row names the table");
        audit!.Should().Contain("\"rowsAnonymized\":1").And.Contain("deleted");

        await RunOneErasurePassAsync(raw, Erased);
        (await CardAsync(raw, Other)).Should().Be(others, "a second pass changes nothing");
    }

    [Fact]
    public async Task The_export_gives_him_his_whole_card_and_nobody_elses()
    {
        var write = typeof(ExportWorker).GetMethod("WriteIdentityProfileAsync", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
        write.Should().NotBeNull("ExportWorker writes the person's own identity card (WriteIdentityProfileAsync)");

        async Task<JsonElement> ExportOfAsync(Guid user)
        {
            using var buffer = new MemoryStream();
            await using (var db = _db.SuperContext())
            {
                using var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true);
                await (Task)write!.Invoke(null, [zip, db, user, CancellationToken.None])!;
            }

            buffer.Position = 0;
            using var read = new ZipArchive(buffer, ZipArchiveMode.Read);
            read.Entries.Select(e => e.FullName).Should().Equal("identity_profile.json");
            using var document = JsonDocument.Parse(new StreamReader(read.GetEntry("identity_profile.json")!.Open()).ReadToEnd());
            return document.RootElement.Clone();
        }

        var his = (await ExportOfAsync(Erased)).GetProperty("card");
        his.GetProperty("user_id").GetGuid().Should().Be(Erased);
        his.GetProperty("name_mr").GetString().Should().Be("पूर्वेश आरवे");
        his.GetProperty("name_en").GetString().Should().Be("Purvesh Arve");
        his.GetProperty("farmer_id").GetString().Should().Be("12345678901");
        his.GetProperty("village_lgd_code").GetInt32().Should().Be(944182);
        his.GetProperty("pin_code").GetString().Should().Be("413304");
        his.GetRawText().Should().NotContain("सुनील").And.NotContain(Other.ToString());

        var none = (await ExportOfAsync(NoCard)).GetProperty("card");
        none.ValueKind.Should().Be(JsonValueKind.Null, "a person who never saved a card gets an honest empty answer");
    }

    private static async Task<string?> CardAsync(NpgsqlConnection db, Guid user) =>
        (string?)await ScalarAsync(db, "SELECT row_to_json(p)::text FROM public.user_identity_profiles p WHERE user_id = @u", ("u", user));

    /// <summary>Runs the real worker until the request reaches a terminal status; asserts Completed; returns the request id.</summary>
    private async Task<Guid> RunOneErasurePassAsync(NpgsqlConnection raw, Guid userId)
    {
        var requestId = Guid.NewGuid();
        await ExecAsync(raw, """
            INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
            VALUES (@id, @uid, NULL, 0, NOW() - INTERVAL '31 days');
            """, ("id", requestId), ("uid", userId));

        var worker = new ErasureWorker(_provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var workerTask = worker.StartAsync(cts.Token);

        var status = (int)ErasureStatus.Requested;
        var deadline = DateTime.UtcNow.AddSeconds(90);
        while (DateTime.UtcNow < deadline)
        {
            status = (int)(await ScalarAsync(raw, "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))!;
            if (status == (int)ErasureStatus.Completed || status == (int)ErasureStatus.Failed)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200), CancellationToken.None);
        }

        cts.Cancel();
        try
        {
            await workerTask;
        }
        catch (OperationCanceledException)
        {
        }

        status.Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete the request for a person with an identity card");
        return requestId;
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<object?> ScalarAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var result = await cmd.ExecuteScalarAsync();
        return result is DBNull ? null : result;
    }
}

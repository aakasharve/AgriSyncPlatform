// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 1 (review M3; founder mandate 2026-10-30:
// nothing goes live that he cannot test). The worker-identity flows with no approved screen — number move, merge and
// its undo, unlink, a person's erasure and its cancel, and re-pointing an EXISTING farm record by link — are OFF in a
// host that does not switch them on: each answers as if its route did not exist, and changes nothing. The flows that
// HAVE approved screens (add with a card, the card, the phone check, link a new team member by card) still work.
using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Labour;

[Trait("Category", "RequiresPostgres")]
public sealed class WorkerIdentityUnscreenedFlowsOffRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    [Fact]
    public async Task Flows_with_no_approved_screen_are_off_and_change_nothing_while_the_screened_ones_work()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var farmA = $"/shramsafal/farms/{FarmA}/labour";
        var farmB = $"/shramsafal/farms/{FarmB}/labour";

        // Screened: add a worker (his card is made), and link him on farm B as a new team member by his card.
        var id = Guid.NewGuid();
        using (var add = await SendAsync(HttpMethod.Post, $"{farmA}/field-operators", Owner,
                   new { displayName = "रमेश पाटील", id, phone = "6000000301", phoneWhose = "Own", homePin = "413304" }))
        {
            add.StatusCode.Should().Be(HttpStatusCode.Created, await add.Content.ReadAsStringAsync());
        }

        var card = await ScalarAsync<string>("""
            SELECT 'SS-' || substr(c.code, 1, 4) || '-' || substr(c.code, 5, 4) FROM ssf.shram_cards c
              JOIN ssf.field_operators f ON f.person_id = c.person_id WHERE f."Id" = @id
            """, id);
        using (var link = await SendAsync(HttpMethod.Post, $"{farmB}/identity/link", OwnerB, new { cardCode = card, id = Guid.NewGuid() }))
        {
            link.StatusCode.Should().Be(HttpStatusCode.Created, await link.Content.ReadAsStringAsync());
        }

        // Unscreened: each answers as a route that does not exist, with nothing written.
        var off = new (HttpMethod Method, string Url, object Body)[]
        {
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/phone/move", new { newPhone = "6000000302", newTicket = Guid.NewGuid(), newCode = "0000", proof = "OwnerConfirms" }),
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/phone/send-code", new { purpose = "MoveNew", phone = "6000000302" }),
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/merge", new { sourceCardCode = card, targetCardCode = card }),
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/unmerge", new { }),
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/unlink", new { }),
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/erasure", new { }),
            (HttpMethod.Post, $"{farmA}/field-operators/{id}/erasure/cancel", new { }),
            (HttpMethod.Post, $"{farmA}/identity/link", new { cardCode = card, fieldOperatorId = FieldOperator }),
        };
        foreach (var (method, url, body) in off)
        {
            using var response = await SendAsync(method, url, Owner, body);
            var text = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, $"{method} {url}: {text}");
            JsonDocument.Parse(text).RootElement.GetProperty("error").GetString().Should().Be("identity.flow_off", url);
        }

        (await ScalarAsync<long>("SELECT count(*) FROM ssf.shram_persons WHERE erasure_requested_at_utc IS NOT NULL", null))
            .Should().Be(0, "no erasure was asked");
        (await ScalarAsync<long>("SELECT count(*) FROM ssf.shram_phone_challenges", null))
            .Should().Be(0, "no move code was sent");
        (await ScalarAsync<long>("SELECT count(*) FROM ssf.field_operators WHERE \"Id\" = @id AND person_id IS NULL", FieldOperator))
            .Should().Be(1, "the seeded record was not re-pointed by link");
    }

    private async Task<T> ScalarAsync<T>(string sql, Guid? id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        if (id is { } value)
        {
            cmd.Parameters.AddWithValue("id", value);
        }

        return (T)(await cmd.ExecuteScalarAsync())!;
    }
}

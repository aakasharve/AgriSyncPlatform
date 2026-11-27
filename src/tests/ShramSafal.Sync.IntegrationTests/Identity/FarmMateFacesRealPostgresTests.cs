// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S3; CTO ruling on founder question 2 = B; P11)
//
// Whose face a person may see, over HTTP on real Postgres as agrisync_app (E3 first): an owner sees his worker's face (refused before this lane); a
// कामगार sees the faces of the people he works for (owner, सहमालक, मुकादम) and never another कामगार's; a waiting or ended seat sees no face and
// shows none; a stranger sees nothing and gets the same 404 as a made-up id. The pull's people rows carry the names in both scripts and the face
// pointer ONLY for a phone that asks (people=1) and only where this reader may see the face; an older phone's pull is the same bytes as before.
// And his own card (GET /user/auth/me/identity) points at his own face.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Sync.IntegrationTests.Labour;
using ShramSafal.Sync.IntegrationTests.TrialSafety;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Identity;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmMateFacesRealPostgresTests(TrialSafetyDatabase db) : IClassFixture<TrialSafetyDatabase>, IAsyncLifetime
{
    private IdentityTestHost _host = default!;

    public async Task InitializeAsync() => _host = await IdentityTestHost.StartAsync(db);

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private sealed record Person(Guid Id, string Token, Guid? Face, string? Sha);

    /// <summary>One farm: its owner, a सहमालक, a मुकादम, two कामगार, a waiting request and an ended seat; and a stranger on another farm. Each has a face.</summary>
    private async Task<Dictionary<string, Person>> FarmAsync(string prefix)
    {
        var names = new[] { "owner", "coowner", "mukadam", "worker1", "worker2", "waiting", "ended", "stranger" };
        var people = new Dictionary<string, Person>();
        for (var i = 0; i < names.Length; i++)
        {
            var (id, token) = await _host.SignUpAsync($"{prefix}{i:00}", names[i]);
            people[names[i]] = new Person(id, token, null, null);
        }

        var account = Guid.NewGuid();
        var farm = Guid.NewGuid();
        await db.SeedAccountAsync(account, people["owner"].Id);
        await db.SeedFarmAsync(farm, people["owner"].Id, account, "XD" + prefix[^4..]);
        await db.SeedSeatAsync(farm, account, people["coowner"].Id, "SecondaryOwner");
        await db.SeedSeatAsync(farm, account, people["mukadam"].Id, "Mukadam");
        await db.SeedSeatAsync(farm, account, people["worker1"].Id, "Worker");
        await db.SeedSeatAsync(farm, account, people["worker2"].Id, "Worker");
        await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, """
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (gen_random_uuid(), @farm, @waiting, 'Worker', NOW(), NOW(), @account, 2, 2),
                   (gen_random_uuid(), @farm, @ended, 'Worker', NOW() - INTERVAL '9 days', NOW(), @account, 5, 2);
            UPDATE ssf.farm_memberships SET revoked_at_utc = NOW() WHERE farm_id = @farm AND user_id = @ended;
            """, ("farm", farm), ("account", account), ("waiting", people["waiting"].Id), ("ended", people["ended"].Id));
        var otherAccount = Guid.NewGuid();
        await db.SeedAccountAsync(otherAccount, people["stranger"].Id);
        await db.SeedFarmAsync(Guid.NewGuid(), people["stranger"].Id, otherAccount, "XS" + prefix[^4..]);

        foreach (var name in names)
        {
            var set = await _host.PutBytesAsync("/shramsafal/pictures/person", people[name].Token, Jpeg((byte)(names.ToList().IndexOf(name) + 1)), "image/jpeg");
            set.Status.Should().Be(HttpStatusCode.OK, name + ": " + set.Raw);
            var face = set.Body.GetProperty("id").GetGuid();
            people[name] = people[name] with { Face = face, Sha = set.Body.GetProperty("sha256").GetString() };
        }

        return people;
    }

    [Fact]
    public async Task The_file_door_follows_the_farm_mate_rule_for_every_seat()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var p = await FarmAsync("62000010");

        async Task<HttpStatusCode> Sees(string viewer, string person) =>
            (await _host.GetAsync($"/shramsafal/pictures/{p[person].Face}", p[viewer].Token)).Status;

        var expected = new Dictionary<string, string[]>
        {
            ["owner"] = ["coowner", "mukadam", "worker1", "worker2"],
            ["coowner"] = ["owner", "mukadam", "worker1", "worker2"],
            ["mukadam"] = ["owner", "coowner", "worker1", "worker2"],
            ["worker1"] = ["owner", "coowner", "mukadam"],
            ["worker2"] = ["owner", "coowner", "mukadam"],
            ["waiting"] = [],
            ["ended"] = [],
            ["stranger"] = [],
        };
        var seen = new List<string>();
        foreach (var (viewer, allowed) in expected)
        {
            foreach (var person in p.Keys.Where(k => k != viewer))
            {
                var status = await Sees(viewer, person);
                seen.Add($"{viewer}->{person}:{(int)status}");
                status.Should().Be(allowed.Contains(person) ? HttpStatusCode.OK : HttpStatusCode.NotFound, $"{viewer} looking at {person}'s face");
            }

            (await Sees(viewer, viewer)).Should().Be(HttpStatusCode.OK, $"{viewer} always sees his own face");
        }

        (await _host.GetAsync($"/shramsafal/pictures/{Guid.NewGuid()}", p["stranger"].Token)).Status
            .Should().Be(HttpStatusCode.NotFound, "a made-up id answers the same as a face he may not see (E4)");
    }

    [Fact]
    public async Task The_pull_carries_names_and_faces_only_to_a_phone_that_asks_and_an_older_phones_pull_is_unchanged()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var p = await FarmAsync("62000020");
        const string pull = "/sync/pull?since=1970-01-01T00:00:00Z";

        var oldBefore = Strip(await _host.GetAsync(pull, p["coowner"].Token));
        (await _host.PutJsonAsync("/user/auth/me/identity", p["owner"].Token, new
        {
            expectedVersion = 0,
            fullName = "owner",
            nameMr = new { value = "मालक पाटील", basis = "Typed" },
            nameEn = new { value = "Malak Patil", basis = "ConvertedConfirmed" },
            farmerId = "999",
        })).Status.Should().Be(HttpStatusCode.OK);
        var oldAfter = Strip(await _host.GetAsync(pull, p["coowner"].Token));
        oldAfter.Should().Be(oldBefore, "a phone that does not ask gets the same pull, byte for byte (P11)");
        oldAfter.Should().NotContain("मालक पाटील").And.NotContain("Malak Patil");
        var oldRows = System.Text.Json.Nodes.JsonNode.Parse(oldAfter)!["operators"]!.AsArray();
        oldRows.Should().NotBeEmpty();
        oldRows.Should().OnlyContain(row => row!.AsObject().Select(x => x.Key).SequenceEqual(new[] { "userId", "displayName", "role" }),
            "an older phone's people rows keep exactly their three keys");

        var asked = await _host.GetAsync(pull + "&people=1", p["coowner"].Token);
        asked.Status.Should().Be(HttpStatusCode.OK, asked.Raw);
        var rows = asked.Body.GetProperty("operators").EnumerateArray().ToDictionary(r => r.GetProperty("userId").GetGuid());
        var owner = rows[p["owner"].Id];
        owner.GetProperty("nameMr").GetString().Should().Be("मालक पाटील");
        owner.GetProperty("nameEn").GetString().Should().Be("Malak Patil");
        owner.GetProperty("pictureId").GetGuid().Should().Be(p["owner"].Face!.Value);
        owner.GetProperty("pictureSha256").GetString().Should().Be(p["owner"].Sha);
        owner.EnumerateObject().Select(x => x.Name).Should().BeEquivalentTo(["userId", "displayName", "role", "nameMr", "nameEn", "pictureId", "pictureSha256"]);
        asked.Raw.Should().NotContain("999", "his Farmer ID is his alone (question 1 = A)");
        var self = rows[p["coowner"].Id];
        self.TryGetProperty("nameMr", out _).Should().BeFalse("he saved no card: an empty name is left out, never null");
        self.GetProperty("pictureId").GetGuid().Should().Be(p["coowner"].Face!.Value);

        // A कामगार's pull still carries no other person's row (MU-3 unchanged): only himself, with his own face.
        var worker = await _host.GetAsync(pull + "&people=1", p["worker1"].Token);
        worker.Body.GetProperty("operators").EnumerateArray().Select(r => r.GetProperty("userId").GetGuid()).Should().Equal(p["worker1"].Id);
        worker.Body.GetProperty("operators")[0].GetProperty("pictureId").GetGuid().Should().Be(p["worker1"].Face!.Value);
        worker.Raw.Should().NotContain("मालक पाटील");

        // An unreadable value says nothing and never refuses the pull.
        var odd = await _host.GetAsync(pull + "&people=yes", p["coowner"].Token);
        odd.Status.Should().Be(HttpStatusCode.OK);
        Strip(odd).Should().Be(oldAfter);
    }

    [Fact]
    public async Task His_own_card_points_at_his_own_face()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var p = await FarmAsync("62000030");

        var card = await _host.GetAsync("/user/auth/me/identity", p["worker1"].Token);

        card.Status.Should().Be(HttpStatusCode.OK, card.Raw);
        card.Body.GetProperty("photo").GetProperty("pictureId").GetGuid().Should().Be(p["worker1"].Face!.Value);
        card.Body.GetProperty("photo").GetProperty("sha256").GetString().Should().Be(p["worker1"].Sha);

        (await _host.SendAsync(System.Net.Http.HttpMethod.Delete, "/shramsafal/pictures/person", p["worker1"].Token, null)).Status
            .Should().BeOneOf(HttpStatusCode.NoContent, HttpStatusCode.OK);
        (await _host.GetAsync("/user/auth/me/identity", p["worker1"].Token)).Body.GetProperty("photo").ValueKind
            .Should().Be(JsonValueKind.Null, "no picture: the card shows his initials, never someone else's face");
    }

    /// <summary>The pull without its three moving clocks (the server's time, the next cursor, the attention board's as-of time).</summary>
    private static string Strip(IdentityTestHost.Reply reply)
    {
        reply.Status.Should().Be(HttpStatusCode.OK, reply.Raw);
        var pull = System.Text.Json.Nodes.JsonNode.Parse(reply.Raw)!.AsObject();
        pull.Remove("serverTimeUtc");
        pull.Remove("nextCursorUtc");
        (pull["attentionBoard"] as System.Text.Json.Nodes.JsonObject)?.Remove("asOfUtc");
        return pull.ToJsonString();
    }

    /// <summary>A tiny JPEG head: the server decides the type from the first bytes.</summary>
    private static byte[] Jpeg(byte fill)
    {
        var bytes = new byte[200];
        new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }.CopyTo(bytes, 0);
        Array.Fill(bytes, fill, 4, bytes.Length - 4);
        return bytes;
    }
}

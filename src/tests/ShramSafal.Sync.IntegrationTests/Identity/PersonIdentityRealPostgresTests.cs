// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1 + S2) - "माझी ओळख": a person's own identity card, over HTTP.
//
// GET / PUT /user/auth/me/identity through the REAL sign-in routes, the real JwtBearer scheme, the held-phone gate and the tenant middleware, on
// real Postgres as agrisync_app (E3 asserted first in every fact). The card is saved and read back the same; every refusal answers its code AND
// its words and writes nothing; a stale version is 409 with the stored version; the full name becomes the login's display_name (older apps show
// it, P11); the server stores the LIST's names for a listed code, never the phone's text; an unknown code is kept as typed and reported, never
// refused (P9); typed text is kept byte for byte.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShramSafal.Sync.IntegrationTests.Labour;
using ShramSafal.Sync.IntegrationTests.TrialSafety;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Identity;

[Trait("Category", "RequiresPostgres")]
public sealed class PersonIdentityRealPostgresTests(TrialSafetyDatabase db) : IClassFixture<TrialSafetyDatabase>, IAsyncLifetime
{
    private const string Door = "/user/auth/me/identity";
    private const int Pandharpur = 944182;
    private static int _refusalPhones;
    private IdentityTestHost _host = default!;

    public async Task InitializeAsync() => _host = await IdentityTestHost.StartAsync(db);

    public async Task DisposeAsync() => await _host.DisposeAsync();

    // ── read and save ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_person_who_never_saved_gets_version_0_his_login_name_his_proven_number_and_nothing_else()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002001", "रमेश पाटील");

        var card = await _host.GetAsync(Door, token);

        card.Status.Should().Be(HttpStatusCode.OK, card.Raw);
        card.Body.GetProperty("userId").GetGuid().Should().Be(me);
        card.Body.GetProperty("version").GetInt32().Should().Be(0);
        card.Body.GetProperty("fullName").GetString().Should().Be("रमेश पाटील");
        card.Body.GetProperty("fullNameScript").GetString().Should().Be("deva");
        card.Body.GetProperty("phone").GetString().Should().Be("+916100002001");
        card.Body.GetProperty("phoneVerifiedAtUtc").ValueKind.Should().Be(JsonValueKind.String, "an SMS sign-in proves the number");
        foreach (var part in new[] { "nameMr", "nameEn", "farmerId", "village", "taluka", "district", "placeListVersion", "pinCode", "photo", "updatedAtUtc" })
        {
            card.Body.GetProperty(part).ValueKind.Should().Be(JsonValueKind.Null, part);
        }

        card.Body.GetProperty("complete").GetBoolean().Should().BeFalse();
        card.Body.TryGetProperty("downgraded", out _).Should().BeFalse("only a save answers what it could not take as sent");
        (await RowCountAsync(me)).Should().Be(0, "reading makes no card");
    }

    [Fact]
    public async Task The_seven_fields_are_saved_and_read_back_the_same_with_the_lists_names_never_the_phones_text()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002002", "Purvesh");

        var saved = await _host.PutJsonAsync(Door, token, new
        {
            expectedVersion = 0,
            fullName = "Purvesh Chandrashekhar Arve",
            nameMr = new { value = "पूर्वेश चंद्रशेखर आरवे", basis = "ConvertedConfirmed" },
            nameEn = (object?)null,
            farmerId = "12345678901",
            village = new { lgdCode = Pandharpur, typedFallback = "TEXT THE PHONE SHOWED" },
            taluka = (object?)null,
            district = (object?)null,
            placeListVersion = "lgd-mh-2026-11-26",
            pinCode = new { value = "413304", basis = "FromVillageList" },
        }, appVersion: "1.0.19-ident");

        saved.Status.Should().Be(HttpStatusCode.OK, saved.Raw);
        var body = saved.Body;
        body.GetProperty("version").GetInt32().Should().Be(1);
        body.GetProperty("fullName").GetString().Should().Be("Purvesh Chandrashekhar Arve");
        body.GetProperty("fullNameScript").GetString().Should().Be("latn");
        body.GetProperty("nameMr").GetProperty("value").GetString().Should().Be("पूर्वेश चंद्रशेखर आरवे");
        body.GetProperty("nameMr").GetProperty("basis").GetString().Should().Be("ConvertedConfirmed");
        body.GetProperty("nameEn").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("farmerId").GetProperty("value").GetString().Should().Be("12345678901");
        body.GetProperty("farmerId").GetProperty("status").GetString().Should().Be("Unverified");
        Place(body, "village").Should().Be((Pandharpur, "पंढरपूर", "Pandharpur", "List"));
        Place(body, "taluka").Should().Be((4249, null, "Pandharpur", "List"), "the taluka comes from the list; no Marathi taluka name is invented (founder question 8)");
        Place(body, "district").Should().Be((496, "सोलापूर", "Solapur", "List"));
        body.GetProperty("placeListVersion").GetString().Should().Be("lgd-mh-2026-11-26");
        body.GetProperty("pinCode").GetProperty("value").GetString().Should().Be("413304");
        body.GetProperty("pinCode").GetProperty("basis").GetString().Should().Be("FromVillageList");
        body.GetProperty("complete").GetBoolean().Should().BeTrue("the name and village, taluka and district are all in");
        body.GetProperty("downgraded").GetArrayLength().Should().Be(0);
        saved.Raw.Should().NotContain("TEXT THE PHONE SHOWED", "a listed code stores the list's names, never the phone's text");

        var read = await _host.GetAsync(Door, token);
        read.Status.Should().Be(HttpStatusCode.OK);
        Without(read.Body, "downgraded").Should().Be(Without(body, "downgraded"), "what was saved is what is read back");

        var row = (await RowsAsync("""
            SELECT version, name_mr, name_mr_basis, name_en, farmer_id, farmer_id_status, village_lgd_code, village_name_mr, village_basis,
                   taluka_lgd_code, district_lgd_code, district_name_mr, place_list_version, pin_code, pin_basis, updated_app_version
            FROM public.user_identity_profiles WHERE user_id = @u
            """, ("u", me))).Single();
        row.Should().Equal(1, "पूर्वेश चंद्रशेखर आरवे", (short)2, null, "12345678901", (short)0, Pandharpur, "पंढरपूर", (short)1,
            4249, 496, "सोलापूर", "lgd-mh-2026-11-26", "413304", (short)2, "1.0.19-ident");
        (await DisplayNameAsync(me)).Should().Be("Purvesh Chandrashekhar Arve", "the full name is the login's name, so older apps show it (P11)");
    }

    [Fact]
    public async Task A_PIN_in_Marathi_digits_is_stored_as_ASCII_and_no_field_makes_the_Farmer_ID_anything_but_Unverified()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002003", "सुनील जाधव");

        var saved = await _host.PutRawAsync(Door, token, """
            {"expectedVersion":0,"fullName":"सुनील जाधव","farmerId":{"value":"१२३४-AB 9","status":"Verified"},"farmerIdStatus":"Verified",
             "pinCode":{"value":"४१३ ३०४","basis":"Typed"},"userId":"00000000-0000-4000-8000-000000000001"}
            """);

        saved.Status.Should().Be(HttpStatusCode.OK, saved.Raw);
        saved.Body.GetProperty("pinCode").GetProperty("value").GetString().Should().Be("413304");
        saved.Body.GetProperty("farmerId").GetProperty("value").GetString().Should().Be("1234-AB 9");
        saved.Body.GetProperty("farmerId").GetProperty("status").GetString().Should().Be("Unverified");
        (await RowsAsync("SELECT pin_code, farmer_id, farmer_id_status FROM public.user_identity_profiles WHERE user_id = @u", ("u", me)))
            .Single().Should().Equal("413304", "1234-AB 9", (short)0);
        (await CountAsync("SELECT count(*) FROM public.user_identity_profiles WHERE user_id = '00000000-0000-4000-8000-000000000001'"))
            .Should().Be(0, "a userId in the body is ignored: the card is the token's person's");
        saved.Body.GetProperty("complete").GetBoolean().Should().BeFalse("no village, taluka or district yet: saved, still बाकी (question 3 = B)");
    }

    [Fact]
    public async Task An_unknown_code_is_kept_as_the_phone_showed_it_and_reported_and_the_taluka_code_fills_the_district()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (_, token) = await _host.SignUpAsync("6100002004", "Ganesh More");

        var saved = await _host.PutJsonAsync(Door, token, new
        {
            expectedVersion = 0,
            fullName = "Ganesh More",
            village = new { lgdCode = 1, typedFallback = "नवी वाडी" },
            taluka = new { lgdCode = 4249 },
        });

        saved.Status.Should().Be(HttpStatusCode.OK, saved.Raw);
        Place(saved.Body, "village").Should().Be((null, "नवी वाडी", null, "NotInList"), "an older list's code is never refused (P9, P11)");
        Place(saved.Body, "taluka").Should().Be((4249, null, "Pandharpur", "List"));
        Place(saved.Body, "district").Should().Be((496, "सोलापूर", "Solapur", "List"), "the district follows the listed taluka");
        saved.Body.GetProperty("downgraded").EnumerateArray().Select(e => e.GetString()).Should().Equal("village");
        saved.Body.GetProperty("complete").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task A_typed_village_keeps_its_text_byte_for_byte_and_a_PIN_said_to_be_the_villages_that_is_not_is_kept_as_typed()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002005", "Ravi");
        const string typed = "  वाडी-१ (नवी)  ";

        var typedVillage = await _host.PutJsonAsync(Door, token, new
        {
            expectedVersion = 0,
            fullName = "Ravi",
            village = new { typed },
            taluka = new { typed = "Pandharpur" },
            district = new { typed = "Solapur" },
        });
        typedVillage.Status.Should().Be(HttpStatusCode.OK, typedVillage.Raw);
        (await RowsAsync("SELECT village_name_mr, village_name_en, village_lgd_code, village_basis, taluka_name_en, taluka_basis FROM public.user_identity_profiles WHERE user_id = @u", ("u", me)))
            .Single().Should().Equal(new object?[] { typed, null, null, (short)2, "Pandharpur", (short)2 });
        typedVillage.Body.GetProperty("placeListVersion").ValueKind.Should().Be(JsonValueKind.Null, "no place came from the list");

        var pinClaim = await _host.PutJsonAsync(Door, token, new
        {
            expectedVersion = 1,
            fullName = "Ravi",
            village = new { lgdCode = Pandharpur },
            pinCode = new { value = "413305", basis = "FromVillageList" },
        });
        pinClaim.Status.Should().Be(HttpStatusCode.OK, pinClaim.Raw);
        pinClaim.Body.GetProperty("pinCode").GetProperty("basis").GetString().Should().Be("Typed", "413305 is not the list's PIN of Pandharpur (P8)");
        pinClaim.Body.GetProperty("downgraded").EnumerateArray().Select(e => e.GetString()).Should().Equal("pinCode");
    }

    // ── refusals: the code AND the words, and nothing written ──────────────────────────────────────

    public static IEnumerable<object[]> Refusals() =>
    [
        ["""{"expectedVersion":0,"fullName":"   "}""", "identity.full_name_required", "The full name is needed. Nothing was saved."],
        [$$"""{"expectedVersion":0,"fullName":"{{new string('a', 101)}}"}""", "identity.name_too_long", "A name is longer than 100 letters. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","nameMr":{"value":"Ravi Patil","basis":"Typed"}}""", "identity.name_wrong_script",
            "The Marathi name may hold only Marathi letters, spaces, dots, apostrophes and dashes. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"रवी","nameEn":{"value":"रवी पाटील","basis":"Typed"}}""", "identity.name_wrong_script",
            "The English name may hold only English letters, spaces, dots, apostrophes and dashes. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","nameMr":{"value":"रवी","basis":"Guessed"}}""", "identity.basis_invalid",
            "A name must say Typed or ConvertedConfirmed, and a PIN Typed or FromVillageList. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","nameMr":"रवी"}""", "identity.basis_invalid",
            "A name must say Typed or ConvertedConfirmed, and a PIN Typed or FromVillageList. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","farmerId":"AB#12"}""", "identity.farmer_id_invalid",
            "A Farmer ID is at most 32 digits, letters, spaces or dashes. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","pinCode":{"value":"012345","basis":"Typed"}}""", "identity.pin_invalid",
            "A PIN is six digits and does not start with 0. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","pinCode":{"value":"4133","basis":"Typed"}}""", "identity.pin_invalid",
            "A PIN is six digits and does not start with 0. Nothing was saved."],
        [$$$"""{"expectedVersion":0,"fullName":"Ravi","village":{"typed":"{{{new string('व', 101)}}}"}}""", "identity.place_typed_too_long",
            "A village, taluka or district typed by hand is longer than 100 letters. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","village":{"lgdCode":944182},"taluka":{"lgdCode":4201}}""", "identity.place_mismatch",
            "The taluka or district does not match the place picked from the list. Nothing was saved."],
        ["""{"expectedVersion":0,"fullName":"Ravi","taluka":{"lgdCode":4249},"district":{"lgdCode":466}}""", "identity.place_mismatch",
            "The taluka or district does not match the place picked from the list. Nothing was saved."],
        ["""[1,2,3]""", "identity.body_invalid", "The card must be sent as one JSON object. Nothing was saved."],
    ];

    [Theory]
    [MemberData(nameof(Refusals))]
    public async Task A_broken_rule_is_refused_by_its_code_and_words_and_nothing_is_written(string raw, string code, string words)
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var phone = "61000021" + System.Threading.Interlocked.Increment(ref _refusalPhones).ToString("00");
        var (me, token) = await _host.SignUpAsync(phone, "जुनं नाव");

        var refused = await _host.PutRawAsync(Door, token, raw);

        refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Raw);
        refused.Body.GetProperty("error").GetString().Should().Be(code);
        refused.Body.GetProperty("message").GetString().Should().Be(words);
        (await RowCountAsync(me)).Should().Be(0);
        (await DisplayNameAsync(me)).Should().Be("जुनं नाव", "a refused card changes nothing, the login's name included");
    }

    [Fact]
    public async Task A_stale_version_is_409_with_the_stored_version_and_nothing_changes_and_the_same_card_again_is_saved_once()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002006", "Asha");
        var first = new { expectedVersion = 0, fullName = "Asha Shinde", farmerId = "777" };
        (await _host.PutJsonAsync(Door, token, first)).Status.Should().Be(HttpStatusCode.OK);
        var before = await RowJsonAsync(me);

        var stale = await _host.PutJsonAsync(Door, token, new { expectedVersion = 0, fullName = "Asha Kale", farmerId = "888" });
        stale.Status.Should().Be(HttpStatusCode.Conflict, stale.Raw);
        stale.Body.GetProperty("error").GetString().Should().Be("identity.stale");
        stale.Body.GetProperty("message").GetString().Should().Be("This card was changed from another phone first. Nothing was saved.");
        stale.Body.GetProperty("currentVersion").GetInt32().Should().Be(1);

        var noVersion = await _host.PutJsonAsync(Door, token, new { fullName = "Asha Kale" });
        noVersion.Status.Should().Be(HttpStatusCode.Conflict, "a save that names no version never overwrites silently (P3)");
        noVersion.Body.GetProperty("currentVersion").GetInt32().Should().Be(1);

        (await RowJsonAsync(me)).Should().Be(before, "nothing changed");
        (await DisplayNameAsync(me)).Should().Be("Asha Shinde");

        // A retried save whose answer was lost: the same card, an old version - answered as saved, nothing written.
        var again = await _host.PutJsonAsync(Door, token, first);
        again.Status.Should().Be(HttpStatusCode.OK, again.Raw);
        again.Body.GetProperty("version").GetInt32().Should().Be(1);
        (await RowJsonAsync(me)).Should().Be(before, "the same content again writes nothing, not even the time");

        var next = await _host.PutJsonAsync(Door, token, new { expectedVersion = 1, fullName = "Asha Kale", farmerId = "888" });
        next.Status.Should().Be(HttpStatusCode.OK, next.Raw);
        next.Body.GetProperty("version").GetInt32().Should().Be(2);
    }

    [Fact]
    public async Task Two_first_saves_at_once_save_one_card_and_answer_the_other_stale()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002007", "Vijay");

        var replies = await Task.WhenAll(Enumerable.Range(0, 4).Select(i =>
            _host.PutJsonAsync(Door, token, new { expectedVersion = 0, fullName = "Vijay " + (char)('A' + i) })));

        replies.Count(r => r.Status == HttpStatusCode.OK).Should().Be(1, string.Join(" | ", replies.Select(r => r.Raw)));
        replies.Where(r => r.Status != HttpStatusCode.OK).Should().OnlyContain(r =>
            r.Status == HttpStatusCode.Conflict && r.Body.GetProperty("error").GetString() == "identity.stale");
        (await RowsAsync("SELECT version FROM public.user_identity_profiles WHERE user_id = @u", ("u", me))).Single().Should().Equal(1);
        var winner = replies.Single(r => r.Status == HttpStatusCode.OK).Body.GetProperty("fullName").GetString();
        (await DisplayNameAsync(me)).Should().Be(winner, "the card and the login's name are one unit of work");
    }

    // ── the login, older apps and the door's own guard ──────────────────────────────────────────

    [Fact]
    public async Task The_old_me_context_shape_still_parses_and_carries_the_names_only_when_he_saved_them()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (_, token) = await _host.SignUpAsync("6100002008", "Kiran");
        string[] oldKeys = ["userId", "displayName", "phoneMasked", "phoneVerifiedAtUtc", "preferredLanguage", "authMode"];

        var before = await _host.GetAsync("/user/auth/me/context", token);
        before.Status.Should().Be(HttpStatusCode.OK, before.Raw);
        var meBefore = before.Body.GetProperty("me");
        meBefore.EnumerateObject().Select(p => p.Name).Should().Equal(oldKeys, "a person with no card gets exactly the 1.0.17 shape (P11)");

        (await _host.PutJsonAsync(Door, token, new
        {
            expectedVersion = 0,
            fullName = "Kiran Pawar",
            nameMr = new { value = "किरण पवार", basis = "Typed" },
        })).Status.Should().Be(HttpStatusCode.OK);

        var after = (await _host.GetAsync("/user/auth/me/context", token)).Body.GetProperty("me");
        after.EnumerateObject().Select(p => p.Name).Should().Equal([.. oldKeys, "nameMr"], "the new name is added last; an empty one is left out");
        after.GetProperty("displayName").GetString().Should().Be("Kiran Pawar");
        after.GetProperty("nameMr").GetString().Should().Be("किरण पवार");
    }

    [Fact]
    public async Task Without_a_token_the_doors_are_401_and_a_held_phone_gets_nothing()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        (await _host.GetAsync(Door, null)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await _host.PutJsonAsync(Door, null, new { expectedVersion = 0, fullName = "x" })).Status.Should().Be(HttpStatusCode.Unauthorized);

        var (me, _) = await _host.SignUpAsync("6100002009", "Sunita");
        var held = await _host.HeldTokenAsync("6100002009", "ident-strangers-phone");
        foreach (var reply in new[] { await _host.GetAsync(Door, held), await _host.PutJsonAsync(Door, held, new { expectedVersion = 0, fullName = "Stranger" }) })
        {
            reply.Status.Should().Be(HttpStatusCode.Forbidden, reply.Raw);
            reply.Body.GetProperty("error").GetString().Should().Be("auth.device_unconfirmed");
        }

        (await DisplayNameAsync(me)).Should().Be("Sunita");
        (await RowCountAsync(me)).Should().Be(0);
    }

    [Fact]
    public async Task The_table_refuses_a_card_that_breaks_its_checks_and_Down_refuses_while_any_card_exists()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (me, token) = await _host.SignUpAsync("6100002010", "Meena");
        (await _host.PutJsonAsync(Door, token, new { expectedVersion = 0, fullName = "Meena", village = new { lgdCode = Pandharpur } }))
            .Status.Should().Be(HttpStatusCode.OK);
        var before = await RowJsonAsync(me);

        foreach (var broken in new[]
                 {
                     "village_lgd_code = NULL",                       // a List village with no code
                     "village_basis = 2",                             // a NotInList village that keeps a code
                     "village_basis = NULL",                          // a village with no basis (an unknown never counts as passing)
                     "pin_code = '413304', pin_basis = NULL",         // a PIN with no basis
                     "name_mr = 'मीना'",                              // a name with no basis
                     "pin_code = '012345', pin_basis = 1",            // a PIN starting with 0
                     "farmer_id_status = 1",                          // anything but Unverified
                     "version = 0",
                 })
        {
            var error = await SuperuserErrorAsync($"UPDATE public.user_identity_profiles SET {broken} WHERE user_id = '{me}'");
            error.Should().NotBeNull(broken);
            error!.SqlState.Should().Be("23514", broken);
        }

        await using (var context = new User.Infrastructure.Persistence.UserDbContext(PurveshDemoReseedHarness.UserOptions(db.SuperuserConn)))
        {
            var down = () => context.Database.GetService<IMigrator>().MigrateAsync("20261127040000_AddLgdPlaceList");
            (await down.Should().ThrowAsync<Npgsql.PostgresException>()).Which.MessageText.Should().MatchRegex(
                @"^AddPersonIdentityProfile Down\(\): \d+ identity card\(s\) exist; a rollback would lose what people typed about themselves\. Restore from the pre-migration snapshot instead\.$");
        }

        (await RowJsonAsync(me)).Should().Be(before, "a refused rollback changes nothing");
    }

    // ── harness ───────────────────────────────────────────────────────────────────────────────────

    private async Task<Npgsql.PostgresException?> SuperuserErrorAsync(string sql)
    {
        try
        {
            await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, sql);
            return null;
        }
        catch (Npgsql.PostgresException ex)
        {
            return ex;
        }
    }

    private static (int? Code, string? Mr, string? En, string Basis) Place(JsonElement card, string part)
    {
        var place = card.GetProperty(part);
        return (
            place.GetProperty("lgdCode").ValueKind == JsonValueKind.Null ? null : place.GetProperty("lgdCode").GetInt32(),
            place.GetProperty("nameMr").GetString(),
            place.GetProperty("nameEn").GetString(),
            place.GetProperty("basis").GetString()!);
    }

    private static string Without(JsonElement card, string member) =>
        JsonSerializer.Serialize(card.EnumerateObject().Where(p => p.Name != member).ToDictionary(p => p.Name, p => p.Value));

    private Task<long> RowCountAsync(Guid user) =>
        CountAsync($"SELECT count(*) FROM public.user_identity_profiles WHERE user_id = '{user}'");

    private async Task<string?> RowJsonAsync(Guid user) =>
        (await RowsAsync("SELECT row_to_json(p)::text FROM public.user_identity_profiles p WHERE user_id = @u", ("u", user))).Single()[0] as string;

    private async Task<string?> DisplayNameAsync(Guid user) =>
        await PurveshDemoReseedHarness.ScalarAsync(db.SuperuserConn, "SELECT display_name FROM public.users WHERE \"Id\" = @u", ("u", user)) as string;

    private Task<long> CountAsync(string sql) => PurveshDemoReseedHarness.CountAsync(db.SuperuserConn, sql);

    private Task<List<object?[]>> RowsAsync(string sql, params (string Name, object Value)[] args) =>
        PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn, sql, args);
}

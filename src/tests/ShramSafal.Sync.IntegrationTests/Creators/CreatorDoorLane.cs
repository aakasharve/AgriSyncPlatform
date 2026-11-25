// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule": creators invite only, own session, no self-approval); build plan slice 15 (the creator door), server half.
//
// The shared arrangement of the creator-door proofs. Real Postgres as agrisync_app, through the real host wired as production wires the door (the gate and the CORS split before
// sign-in; the door's own bearer scheme). Farmers and staff sign in with the lane's test sign-in (X-Test-UserId); a CREATOR signs in for real: invited by staff through the staff
// route, a code "sent" to a capturing sender, verified at /creator/auth/verify, and from then on his real access token and his real cookie. The crossed-token proof has its own
// class with the production token wiring on BOTH sides. Fake numbers only (60000xxxxx); no dose from any real schedule.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api.CreatorDoor;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Planning;
using ShramSafal.Sync.IntegrationTests.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Creators;

/// <summary>The "SMS gateway" of the proofs: it keeps every code it was asked to send, so a test can read the one its phone would have received.</summary>
public sealed class CapturedCodes : ICreatorSignInCodeSender
{
    private readonly ConcurrentDictionary<string, List<string>> _sent = new();

    public bool Fail { get; set; }

    public Task<bool> SendAsync(string phone, string code, CancellationToken ct = default)
    {
        if (Fail)
        {
            return Task.FromResult(false);
        }

        _sent.GetOrAdd(phone, _ => []).Add(code);
        return Task.FromResult(true);
    }

    public IReadOnlyList<string> For(string phone) => _sent.TryGetValue(phone, out var list) ? list.ToList() : [];
}

public abstract class CreatorDoorLane(ITestOutputHelper output) : ScheduleGateLane(output)
{
    protected const string CreatorOrigin = "https://schedule.creator-door.test";
    protected const string MainOrigin = "https://app.main-door.test";
    protected const string CookieName = "shramsafal_creator_refresh";
    protected const string DeviceHeader = "X-Creator-Device-Id";
    protected const string PhoneA = "6000015001";
    protected const string PhoneB = "6000015002";
    protected const string DoseOne = "२ ग्रॅम प्रति लिटर";
    protected const string DoseTwo = "३ ग्रॅम प्रति लिटर";
    protected const string WorkName = "द्राक्ष: निर्मात्याचे चाचणी वेळापत्रक";

    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
    private bool _staffSeeded;

    protected CapturedCodes Codes { get; } = new();

    /// <summary>Where the host keeps files (the local storage of the proofs).</summary>
    protected string StorageDirectory { get; private set; } = string.Empty;

    protected virtual bool DoorOn => true;
    protected virtual string TermsVersion => string.Empty;

    protected override void AddHostConfiguration(IDictionary<string, string?> settings)
    {
        settings["CreatorDoor:Enabled"] = DoorOn ? "true" : "false";
        settings["CreatorDoor:AllowedOrigins:0"] = CreatorOrigin;
        settings["CreatorDoor:TermsVersion"] = TermsVersion;
        settings["Cors:AllowedOrigins:0"] = MainOrigin;
        StorageDirectory = settings["ShramSafal:Storage:DataDirectory"]!;
    }

    protected override void AddHostServices(IServiceCollection services)
    {
        services.AddSingleton<ICreatorSignInCodeSender>(Codes);
        // The main CORS policy, as Program.cs names it; the creator door's own policy comes with the module.
        services.AddCors(options => options.AddPolicy("AllowFrontend", policy => policy
            .WithOrigins(MainOrigin).WithHeaders("Content-Type", "Authorization").WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS").AllowCredentials()));
    }

    protected override void UseBeforeAuthentication(WebApplication app)
    {
        // Exactly the two calls Program.cs makes in place of a bare UseCors.
        app.UseCreatorDoorGate();
        app.UseCorsKeepingCreatorDoorApart("AllowFrontend");
    }

    // ── requests at the door ─────────────────────────────────────────────────────────────────────────────────────────────

    protected sealed record Reply(HttpStatusCode Status, string Body, IReadOnlyList<string> SetCookies, HttpResponseHeaders Headers)
    {
        public JsonElement Json => JsonDocument.Parse(Body).RootElement.Clone();

        public string? Error => string.IsNullOrWhiteSpace(Body) || !Body.TrimStart().StartsWith('{') ? null
            : Json.TryGetProperty("error", out var e) ? e.GetString() : null;

        public string? Message => string.IsNullOrWhiteSpace(Body) || !Body.TrimStart().StartsWith('{') ? null
            : Json.TryGetProperty("message", out var m) ? m.GetString() : null;

        /// <summary>The value of the door's refresh cookie this answer set (empty when it cleared it; null when it set none).</summary>
        public string? RefreshCookie => SetCookies
            .Where(c => c.StartsWith(CookieName + "=", StringComparison.Ordinal))
            .Select(c => c[(CookieName.Length + 1)..].Split(';')[0])
            .FirstOrDefault();
    }

    /// <summary>One request to the host exactly as given: nothing is added that the caller did not name (no test sign-in).</summary>
    protected async Task<Reply> DoorAsync(
        HttpMethod method, string path, object? body = null, string? bearer = null, string? cookie = null, string? deviceId = null,
        string? origin = CreatorOrigin, HttpContent? content = null, IReadOnlyDictionary<string, string>? headers = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (bearer is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }

        if (cookie is not null)
        {
            request.Headers.Add("Cookie", $"{CookieName}={cookie}");
        }

        if (deviceId is not null)
        {
            request.Headers.Add(DeviceHeader, deviceId);
        }

        if (origin is not null)
        {
            request.Headers.Add("Origin", origin);
        }

        foreach (var (name, value) in headers ?? new Dictionary<string, string>())
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        request.Content = content ?? (body is null ? null : body is string text ? new StringContent(text, Encoding.UTF8, "application/json") : JsonContent.Create(body));
        using var response = await SendRawAsync(request);
        var answer = await response.Content.ReadAsStringAsync();
        var cookies = response.Headers.TryGetValues("Set-Cookie", out var values) ? values.ToList() : [];
        Output.WriteLine($"[door] {method} {path} -> {(int)response.StatusCode} {(answer.Length > 300 ? answer[..300] + "…" : answer)}");
        return new Reply(response.StatusCode, answer, cookies, response.Headers);
    }

    // ── staff and creators ───────────────────────────────────────────────────────────────────────────────────────────────

    protected async Task EnsureStaffAsync()
    {
        if (!_staffSeeded)
        {
            _staffSeeded = true;
            await SeedReviewSeatsAsync();
        }
    }

    /// <summary>ShramSafal staff (the platform owner by default) invite a phone through the staff route; returns the creator id.</summary>
    protected async Task<Guid> InviteAsync(string phone, string name = "निर्माता चाचणी", Guid? staff = null)
    {
        await EnsureStaffAsync();
        var (status, body) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/creator-door/creators", staff ?? PlatformOwner, new { phone, displayName = name });
        status.Should().Be(HttpStatusCode.Created, body);
        return Json(body).GetProperty("id").GetGuid();
    }

    protected sealed record Creator(Guid Id, string Phone, string Token, string Cookie, string DeviceId);

    protected static string NewDeviceId() => "browser-" + Guid.NewGuid().ToString("N");

    /// <summary>The real sign-in: ask for a code, read the one "sent", verify it; the access token from the body and the refresh credential from the cookie.</summary>
    protected async Task<Creator> SignInAsync(string phone, string? deviceId = null)
    {
        var device = deviceId ?? NewDeviceId();
        var start = await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone });
        start.Status.Should().Be(HttpStatusCode.OK, start.Body);
        var code = Codes.For(phone).LastOrDefault();
        code.Should().NotBeNull("an invited phone is sent a code");
        var verify = await DoorAsync(HttpMethod.Post, "/creator/auth/verify", new { phone, code }, deviceId: device);
        verify.Status.Should().Be(HttpStatusCode.OK, verify.Body);
        var cookie = verify.RefreshCookie;
        cookie.Should().NotBeNullOrEmpty("the refresh credential travels in the door's cookie");
        return new Creator(verify.Json.GetProperty("creatorId").GetGuid(), phone, verify.Json.GetProperty("accessToken").GetString()!, cookie!, device);
    }

    protected async Task<Creator> InvitedCreatorAsync(string phone = PhoneA, string name = "निर्माता चाचणी")
    {
        await InviteAsync(phone, name);
        return await SignInAsync(phone);
    }

    // ── the work: a reference schedule in format 2, the shape the staff import takes ─────────────────────────────────────

    protected static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    protected static IReadOnlyList<ScheduleTaskContent> Tasks(string dose) =>
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30), ScheduleBasis.Stated, 0, 1,
            Dose: dose, Products: [new ScheduleProduct("चाचणी औषध", dose, "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30),
        new("t-water", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(5), ScheduleBasis.Stated, 0, 2),
    ];

    protected static string Body(string name = WorkName, string dose = DoseOne, string ownerType = "EXPERT", Guid? previousVersionId = null) =>
        JsonSerializer.Serialize(new
        {
            format = 2,
            name,
            cropKey = "grape",
            ownerType,
            sourceLabel = "चाचणी निर्माता",
            previousVersionId,
            stages = new object[]
            {
                new { name = "छाटणी आणि फूट", startDay = 0, endDay = 40, startSign = (string?)null, endSign = (string?)null },
                new { name = "मण्यांची वाढ", startDay = 41, endDay = 99, startSign = (string?)null, endSign = (string?)null },
            },
            tasks = Tasks(dose).Select(Canonical).ToArray(),
            challenges = Array.Empty<object>(),
        }, WebJson);

    protected async Task<Guid> NewDraftAsync(Creator creator, string? body = null)
    {
        var reply = await DoorAsync(HttpMethod.Post, "/creator/submissions", body ?? Body(), bearer: creator.Token);
        reply.Status.Should().Be(HttpStatusCode.Created, reply.Body);
        return reply.Json.GetProperty("id").GetGuid();
    }

    protected async Task SubmitAsync(Creator creator, Guid submission)
    {
        var reply = await DoorAsync(HttpMethod.Post, $"/creator/submissions/{submission}/submit", bearer: creator.Token);
        reply.Status.Should().Be(HttpStatusCode.OK, reply.Body);
        reply.Json.GetProperty("state").GetString().Should().Be("Submitted");
    }

    protected async Task<Guid> SentWorkAsync(Creator creator, string? body = null)
    {
        var draft = await NewDraftAsync(creator, body);
        await SubmitAsync(creator, draft);
        return draft;
    }

    /// <summary>The staff checker's view of a sent round (the platform employee by default).</summary>
    protected async Task<JsonElement> StaffViewAsync(Guid submission, Guid? staff = null)
    {
        var (status, body) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/creator-door/submissions/{submission}", staff ?? PlatformEmployee, null);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    /// <summary>The approval, exactly as slice 7 asks: every task key ticked, on the content hash the checker saw. Returns the library schedule id.</summary>
    protected async Task<Guid> ApproveAsync(Guid submission, Guid? staff = null)
    {
        var view = await StaffViewAsync(submission, staff);
        var (status, body) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/creator-door/submissions/{submission}/approve", staff ?? PlatformEmployee, new
        {
            checkedTaskKeys = view.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("taskKey").GetString()!).ToArray(),
            checkedChallengeKeys = Array.Empty<string>(),
            contentHash = view.GetProperty("contentHash").GetString(),
            checkerDisplayName = DisplayName,
        });
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body).GetProperty("libraryScheduleId").GetGuid();
    }

    protected Task<(HttpStatusCode Status, string Body)> ReturnAsync(Guid submission, string? reasons, Guid? staff = null) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/creator-door/submissions/{submission}/return", staff ?? PlatformEmployee, new { reasons });

    // ── files ────────────────────────────────────────────────────────────────────────────────────────────────────────────

    protected Task<Reply> UploadAsync(Creator creator, Guid submission, byte[] bytes, string fileName, string declaredType = "application/octet-stream")
    {
        var form = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes);
        part.Headers.ContentType = MediaTypeHeaderValue.Parse(declaredType);
        form.Add(part, "file", fileName);
        return DoorAsync(HttpMethod.Post, $"/creator/submissions/{submission}/files", bearer: creator.Token, content: form);
    }

    /// <summary>A small PDF by its first bytes, padded to <paramref name="size"/>.</summary>
    protected static byte[] Pdf(int size = 600, byte fill = (byte)' ')
    {
        var head = Encoding.ASCII.GetBytes("%PDF-1.4\n% creator door test file\n");
        var bytes = Enumerable.Repeat(fill, Math.Max(size, head.Length)).ToArray();
        head.CopyTo(bytes, 0);
        return bytes;
    }

    // ── the database, as superuser (what is really kept) and as the app role with a scope set by hand ────────────────────

    protected async Task<string> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args)
        {
            cmd.Parameters.AddWithValue(n, v);
        }

        return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    /// <summary>The four settings a request can carry, exactly as the server sets them (transaction-local).</summary>
    protected sealed record Scope(Guid? Farm = null, Guid? User = null, Guid? Creator = null, string? DoorKey = null);

    private static async Task ApplyAsync(NpgsqlConnection db, Scope scope)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @f, true), set_config('agrisync.user_id', @u, true), set_config('agrisync.creator_id', @c, true), set_config('agrisync.creator_door_key', @k, true)";
        cmd.Parameters.AddWithValue("f", scope.Farm?.ToString() ?? string.Empty);
        cmd.Parameters.AddWithValue("u", scope.User?.ToString() ?? string.Empty);
        cmd.Parameters.AddWithValue("c", scope.Creator?.ToString() ?? string.Empty);
        cmd.Parameters.AddWithValue("k", scope.DoorKey ?? string.Empty);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>How many rows the app role sees under <paramref name="scope"/>.</summary>
    protected async Task<int> AppRowsAsync(Scope scope, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ApplyAsync(db, scope);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var n = 0;
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            n++;
        }

        return n;
    }

    /// <summary>A write as the app role under <paramref name="scope"/>, rolled back: the rows it changed, or the SQLSTATE that refused it.</summary>
    protected async Task<(int Rows, string? SqlState)> AppWriteAsync(Scope scope, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ApplyAsync(db, scope);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        try
        {
            return (await cmd.ExecuteNonQueryAsync(), null);
        }
        catch (PostgresException ex)
        {
            return (0, ex.SqlState);
        }
    }
}

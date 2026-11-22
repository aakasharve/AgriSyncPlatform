// spec: plr-d10 SEC-1 server fixes (D-184), finding F04 - one push may not carry an unbounded number of changes.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// SEC-1 F04, through the real <c>POST /sync/push</c> route on the sync-test host (the same harness the sibling sync tests
/// use). A push of up to 200 changes is accepted (the phone sends at most 50); a push of 201 or more is refused WHOLE with
/// HTTP 413 and the body <c>{ "error": "ShramSafal.Sync.BatchTooLarge", "message": ... }</c> - and nothing in a refused push
/// is written. "Nothing is written" is proved with the idempotency record: the same changes sent again, in a batch that is
/// within the cap, are applied FRESH (status <c>applied</c>), never answered <c>duplicate</c>.
///
/// <para>Written from the SEC-1 test spec (F04) alone. The endpoint's and the handler's source were not read.</para>
/// </summary>
public sealed class SyncPushBatchSizeCapTests
{
    private const string TooLargeCode = "ShramSafal.Sync.BatchTooLarge";
    private const int Cap = 200;

    [Theory]
    [InlineData(1)]
    [InlineData(50)]
    [InlineData(Cap)]
    public async Task A_push_up_to_the_cap_is_accepted_and_every_change_is_answered(int count)
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();

        var response = await PostAsync(harness, $"cap-ok-{count}", FarmChanges(count, "ok"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var results = doc.RootElement.GetProperty("results");
        Assert.Equal(count, results.GetArrayLength());
        Assert.All(results.EnumerateArray(), r => Assert.Equal("applied", r.GetProperty("status").GetString()));
    }

    [Theory]
    [InlineData(Cap + 1)]
    [InlineData(5_000)]
    public async Task A_push_over_the_cap_is_refused_whole_with_413_and_BatchTooLarge(int count)
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();

        var response = await PostAsync(harness, $"cap-over-{count}", FarmChanges(count, "over"));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(TooLargeCode, doc.RootElement.GetProperty("error").GetString());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("message").GetString()));
        Assert.False(doc.RootElement.TryGetProperty("results", out _), "a refused push carries no per-change results");
    }

    [Fact]
    public async Task A_refused_push_writes_nothing_so_the_same_changes_sent_again_are_applied_fresh()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();
        const string device = "cap-nothing-written";

        // 201 changes: refused whole.
        var changes = FarmChanges(Cap + 1, "nothing-written");
        var refused = await PostAsync(harness, device, changes);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, refused.StatusCode);

        // The first 200 of those very changes (same device, same request ids), now within the cap. If the refused push had
        // written anything - the changes or their idempotency records - these would come back as "duplicate".
        var again = await PostAsync(harness, device, changes.Take(Cap).ToList());
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        using var doc = JsonDocument.Parse(await again.Content.ReadAsStringAsync());
        var statuses = doc.RootElement.GetProperty("results").EnumerateArray()
            .Select(r => r.GetProperty("status").GetString())
            .ToList();
        Assert.Equal(Cap, statuses.Count);
        Assert.All(statuses, s => Assert.Equal("applied", s));
    }

    [Fact]
    public async Task The_cap_applies_to_the_number_of_changes_not_to_how_many_ids_they_carry()
    {
        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync();

        // 201 changes that all carry the same clientRequestId: still 201 changes.
        var farmId = Guid.NewGuid();
        var changes = Enumerable.Range(0, Cap + 1)
            .Select(i => (object)new
            {
                clientRequestId = "cap-same-id",
                mutationType = "create_farm",
                payload = new { farmId, name = $"Same Id Farm {i}" },
            })
            .ToList();

        var response = await PostAsync(harness, "cap-same-id-device", changes);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private static List<object> FarmChanges(int count, string tag) =>
        Enumerable.Range(0, count)
            .Select(i => (object)new
            {
                clientRequestId = $"cap-{tag}-{i}",
                mutationType = "create_farm",
                payload = new { farmId = Guid.NewGuid(), name = $"Cap Farm {tag} {i}" },
            })
            .ToList();

    private static Task<System.Net.Http.HttpResponseMessage> PostAsync(
        SyncEndpointsTests.TestHarness harness, string deviceId, IReadOnlyList<object> mutations) =>
        harness.Client.PostAsJsonAsync("/sync/push", new { deviceId, mutations });
}

// spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task K2; asked for by the independent re-review of
// 2026-11-14).
//
// THE REAL SYNC ROUTE NAMES A REFUSED SAVE.
//
// POST /sync/push answers 200 while refusing work inside it. Since ADR 0027 the route says WHICH refusals on
// HttpContext.Items (RequestObservabilityKeys.RejectedWorkCodes), and the server's request middleware copies that into
// the sync.mutation_rejected row. Until now two halves were tested and the join between them was not:
//   - SyncRejectedCodesTests holds the rule as a pure function (SyncEndpoints.DistinctRejectedCodes);
//   - RequestObservabilityMiddlewareTests.The_middleware_passes_stamped_codes_to_the_row holds the middleware, fed by an
//     endpoint made by hand.
// Nothing proved that the real route calls the function and stamps its answer. A route that computed the codes and
// forgot to stamp them, stamped them under another key, or stamped every result's code, passed both.
//
// HOW THE REAL ROUTE IS REACHED. SyncEndpointsTests.TestHarness builds a host in memory and maps the ShramSafal API's
// own routes (MapShramSafalApi), so POST /sync/push here is the production route and handler on an in-memory store. It
// needs no database. The harness is HTTP-only, so on its own it cannot see what a route leaves on the request. Its
// last-mile service hook is used to register an IStartupFilter, which ASP.NET Core applies around the whole pipeline of
// a host it did not build. The filter mounts, from the outside in:
//   1. a witness, which after everything inside it has finished copies the request item the route stamped;
//   2. the server's own RequestObservabilityMiddleware, unchanged, writing to a capturing IAnalyticsWriter.
// No production file is changed and the harness is not edited.
//
// WHAT IS OBSERVED. Both things, on the same request: the request item (what the ROUTE did) and the
// sync.mutation_rejected row (what the server RECORDS from it).
//
// THE REFUSAL is the one SyncEndpointsTests.CreateDailyLog_WithUnknownField_IsRejected already expects: a
// create_daily_log whose payload holds a field the server does not know is answered status "failed", error code
// ShramSafal.SyncInvalidPayload. Here the batch holds TWO such logs, so "each code once" can be told from "one entry
// per refusal".
//
// NOT ASSERTED, AND WHY.
//   - The row's personId and route. The filter mounts the middleware OUTSIDE authentication and routing, which is not
//     where Program.cs has it. Those keys are held by RequestObservabilityMiddlewareTests.
//   - Byte equality of the response: its body carries the server's clock.
//
// HOW TO TELL A BROKEN HARNESS FROM THE MISSING RULE. A message that begins "HARNESS:" means the witness never saw the
// request (the filter was not applied). One that begins "SCENARIO:" means the server did not answer the batch as the
// neighbouring test expects, so there was no refusal of the expected kind to stamp. Neither is the stamp failing.
// One more: should the ONLY row for the refused push be an api.slow, the request took longer than the server's slow
// threshold on that machine; the request item is the assertion that does not depend on time.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Observability;

public sealed class SyncPushRejectedCodesStampTests
{
    /// <summary>The status the app receives for a save the server refused.</summary>
    private const string Refused = "failed";

    /// <summary>The code of the refusal this class provokes, as the neighbouring test expects it.</summary>
    private const string RefusedCode = "ShramSafal.SyncInvalidPayload";

    private const string RefusedSyncRow = "sync.mutation_rejected";

    private const string DeviceId = "device-stamp";

    /// <summary>Test-only. Tells the witness which of the three pushes a request is.</summary>
    private const string TagHeader = "X-Test-Push-Tag";

    private const string BeforeTag = "accepted-before";
    private const string RefusedTag = "refused";
    private const string AfterTag = "accepted-after";

    private const string PlotRequest = "req-plot-stamp";
    private const string CycleRequest = "req-cycle-stamp";
    private const string FirstLogRequest = "req-log-stamp-1";
    private const string SecondLogRequest = "req-log-stamp-2";

    /// <summary>The keys of the push response and of one result, as they were before this plan (SyncDtos.cs).</summary>
    private static readonly string[] ResponseKeys = ["serverTimeUtc", "results"];

    private static readonly string[] ResultKeys =
        ["clientRequestId", "mutationType", "status", "data", "errorCode", "errorMessage"];

    private static readonly string[] ResultKeysAlwaysPresent = ["clientRequestId", "mutationType", "status"];

    // ------------------------------------------------------------------
    // The stamp
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_real_route_names_a_refused_save_once_on_the_request_that_refused_it()
    {
        var witness = new Witness();
        var writer = new CapturingWriter();

        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync(services =>
        {
            services.RemoveAll<IAnalyticsWriter>();
            services.AddSingleton<IAnalyticsWriter>(writer);
            services.AddSingleton<IStartupFilter>(new AroundTheRealPipeline(witness));
        });

        var pushed = await PushTheThreeAsync(harness.Client);

        using var refusedDoc = JsonDocument.Parse(pushed.RefusedBody);
        var results = refusedDoc.RootElement.GetProperty("results");
        ShouldHaveRefusedBothLogs(results);

        // The rule, applied to what the app was told: the code of every
        // refused result, each once, in ordinal order.
        var expectedCodes = RefusedCodesIn(results);
        var refusedCount = results.EnumerateArray().Count(r => r.GetProperty("status").GetString() == Refused);

        expectedCodes.Should().Contain(RefusedCode);
        refusedCount.Should().BeGreaterThanOrEqualTo(2, "SCENARIO: the batch holds two logs the server refuses");

        // ---- 1. What the route left on the request ----

        var refused = await witness.OfAsync(RefusedTag);

        refused.Method.Should().Be("POST");
        refused.Path.Should().Be("/sync/push");
        refused.StatusCode.Should().Be(200, "the refusal is inside a response that itself succeeded");

        refused.CodesStamped.Should().BeTrue(
            "the real route refused two saves in this request, so it stamps their codes on the request "
            + $"under RequestObservabilityKeys.RejectedWorkCodes (\"{RequestObservabilityKeys.RejectedWorkCodes}\"). "
            + "That item is the only way a 200 can say what it refused");
        refused.Codes.Should().NotBeNull(
            $"the item holds the codes as text, one entry per code; found an item of type {refused.CodesType}");
        refused.Codes.Should().Equal(
            expectedCodes,
            "the stamp is exactly the codes of the refused results in the response: nothing an accepted "
            + "result carries, nothing missing, in ordinal order");
        refused.Codes!.Count(c => c == RefusedCode).Should().Be(1,
            $"two saves were refused with {RefusedCode}, and the code is recorded once, not once per refusal");

        // The requests either side of it refused nothing, and name nothing:
        // the codes belong to the request that refused, and do not leak
        // into the next one.
        ShouldNameNothing(await witness.OfAsync(BeforeTag), "the push before it was accepted whole");
        ShouldNameNothing(await witness.OfAsync(AfterTag), "the push after it was accepted whole");

        // ---- 2. What the server records from it ----

        var rows = await SettledRowsAsync(writer);
        var refusedRows = rows.Where(r => r.EventType == RefusedSyncRow).ToList();

        if (refusedRows.Count != 1)
        {
            Assert.Fail(
                $"Expected exactly one {RefusedSyncRow} row for three pushes of which one refused work, but found "
                + $"{refusedRows.Count}. One refusing request is one row; an accepted push writes none.\n"
                + $"Every row the server's middleware and handlers emitted:\n{Dump(rows)}");
        }

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(refusedRows[0].PropsJson)!;

        props.Should().ContainKey("rejectedWorkCodes",
            "the row for a refused sync save names what was refused; a count alone cannot say what");
        props["rejectedWorkCodes"].ValueKind.Should().Be(JsonValueKind.Array);
        props["rejectedWorkCodes"].EnumerateArray().Select(c => c.GetString()).Should().Equal(
            expectedCodes,
            "the row carries exactly the codes the route stamped on this request, each once");

        props["rejectedWorkItems"].GetInt32().Should().Be(refusedCount,
            "how many saves were refused is still recorded, beside which: two refusals, one code");
        props["statusCode"].GetInt32().Should().Be(200);
        props["endpoint"].GetString().Should().Be("POST /sync/push", "the row is the refused push's own");
    }

    // ------------------------------------------------------------------
    // The response the app receives
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_response_to_a_push_that_refused_work_is_what_the_app_already_expects()
    {
        // The same pushes twice: on the harness exactly as the neighbouring
        // tests use it, and with the recording mounted around it.
        string plainBody;
        await using (var plain = await SyncEndpointsTests.TestHarness.CreateAsync())
        {
            plainBody = (await PushTheThreeAsync(plain.Client)).RefusedBody;
        }

        var witness = new Witness();
        var writer = new CapturingWriter();

        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync(services =>
        {
            services.RemoveAll<IAnalyticsWriter>();
            services.AddSingleton<IAnalyticsWriter>(writer);
            services.AddSingleton<IStartupFilter>(new AroundTheRealPipeline(witness));
        });

        var pushed = await PushTheThreeAsync(harness.Client);

        // The control: this is a request on which the route DID stamp codes.
        // Without it, an unchanged response would prove nothing about the stamp.
        (await witness.OfAsync(RefusedTag)).CodesStamped.Should().BeTrue(
            "this test is about the response of a request the route stamped; see the test above");

        foreach (var (body, which) in new[] { (plainBody, "without the recording"), (pushed.RefusedBody, "with the recording") })
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            // What CreateDailyLog_WithUnknownField_IsRejected expects of the
            // same refusal, for both logs.
            var results = root.GetProperty("results");
            ShouldHaveRefusedBothLogs(results);

            // The shape an installed app parses: two keys, and per result
            // the six of SyncMutationResultDto and no other.
            root.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                ResponseKeys,
                $"the push response has these two keys and no other ({which}): the stamp travels on the "
                + "request inside the server and adds nothing to what the app receives");
            root.GetProperty("serverTimeUtc").TryGetDateTime(out _).Should().BeTrue();

            results.ValueKind.Should().Be(JsonValueKind.Array);
            results.EnumerateArray().Select(r => r.GetProperty("clientRequestId").GetString()).Should().BeEquivalentTo(
                new[] { PlotRequest, CycleRequest, FirstLogRequest, SecondLogRequest },
                $"one result per save that was sent, each once ({which})");

            foreach (var result in results.EnumerateArray())
            {
                var keys = result.EnumerateObject().Select(p => p.Name).ToList();
                keys.Should().BeSubsetOf(ResultKeys, $"a result has no key the app does not already know ({which})");
                keys.Should().Contain(ResultKeysAlwaysPresent);
            }

            body.Should().NotContainEquivalentOf("rejectedWork",
                $"the names of the stamp are the server's own and never reach the app ({which})");
            body.Should().NotContainEquivalentOf("observability");
        }

        // And the two answers are the same answer: same results in the same
        // order, same statuses, same codes, same keys. (Ids and the clock
        // differ between two runs, so they are not compared.)
        ShapeOf(pushed.RefusedBody).Should().Equal(
            ShapeOf(plainBody),
            "mounting the recording changes nothing the app receives");

        // As the neighbouring test ends: a refused log was not saved.
        (await harness.DailyLogExistsAsync(pushed.FirstLogId)).Should().BeFalse("a refused save is not applied");
        (await harness.DailyLogExistsAsync(pushed.SecondLogId)).Should().BeFalse();
    }

    // ------------------------------------------------------------------
    // The three pushes
    // ------------------------------------------------------------------

    private sealed record Pushed(string RefusedBody, Guid FirstLogId, Guid SecondLogId);

    /// <summary>
    /// An accepted push, then the push that refuses two saves, then another accepted push. The middle one is the batch
    /// of <c>SyncEndpointsTests.CreateDailyLog_WithUnknownField_IsRejected</c> with a second refused log added.
    /// </summary>
    private static async Task<Pushed> PushTheThreeAsync(HttpClient client)
    {
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var firstLogId = Guid.NewGuid();
        var secondLogId = Guid.NewGuid();

        var before = await PushAsync(client, BeforeTag, new
        {
            deviceId = DeviceId,
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-farm-stamp",
                    mutationType = "create_farm",
                    payload = new { farmId, name = "Stamp Farm" }
                }
            }
        });
        ShouldHaveAppliedItsOnlySave(before, BeforeTag);

        var refused = await PushAsync(client, RefusedTag, new
        {
            deviceId = DeviceId,
            mutations = new object[]
            {
                new
                {
                    clientRequestId = PlotRequest,
                    mutationType = "create_plot",
                    payload = new { plotId, farmId, name = "Stamp Plot", areaInAcres = 1m }
                },
                new
                {
                    clientRequestId = CycleRequest,
                    mutationType = "create_crop_cycle",
                    payload = new { cropCycleId, farmId, plotId, cropName = "Grapes", stage = "Growth", startDate = "2026-02-21" }
                },
                new
                {
                    // `notARealField` is not a field the server knows: the save is refused.
                    clientRequestId = FirstLogRequest,
                    mutationType = "create_daily_log",
                    payload = new
                    {
                        dailyLogId = firstLogId,
                        farmId,
                        plotId,
                        cropCycleId,
                        logDate = "2026-02-22",
                        notARealField = "nope"
                    }
                },
                new
                {
                    // The same refusal a second time, on another day's log.
                    clientRequestId = SecondLogRequest,
                    mutationType = "create_daily_log",
                    payload = new
                    {
                        dailyLogId = secondLogId,
                        farmId,
                        plotId,
                        cropCycleId,
                        logDate = "2026-02-23",
                        notARealField = "nope"
                    }
                }
            }
        });

        var after = await PushAsync(client, AfterTag, new
        {
            deviceId = DeviceId,
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-farm-stamp-after",
                    mutationType = "create_farm",
                    payload = new { farmId = Guid.NewGuid(), name = "Stamp Farm Two" }
                }
            }
        });
        ShouldHaveAppliedItsOnlySave(after, AfterTag);

        return new Pushed(refused, firstLogId, secondLogId);
    }

    private static async Task<string> PushAsync<T>(HttpClient client, string tag, T body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/sync/push")
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Add(TagHeader, tag);

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            $"POST /sync/push answers 200 whether or not it refused work inside it (the push tagged \"{tag}\")");

        return await response.Content.ReadAsStringAsync();
    }

    private static void ShouldHaveAppliedItsOnlySave(string body, string tag)
    {
        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("results")[0].GetProperty("status").GetString().Should().Be("applied",
            $"SCENARIO: the push tagged \"{tag}\" creates a farm and is accepted, as in every neighbouring test. "
            + "This is not the stamp failing");
    }

    /// <summary>What <c>CreateDailyLog_WithUnknownField_IsRejected</c> asserts, for each of the two logs.</summary>
    private static void ShouldHaveRefusedBothLogs(JsonElement results)
    {
        foreach (var request in new[] { FirstLogRequest, SecondLogRequest })
        {
            var result = results.EnumerateArray()
                .Single(r => r.GetProperty("clientRequestId").GetString() == request);

            result.GetProperty("status").GetString().Should().Be(Refused,
                $"SCENARIO: a daily log with an unknown field is refused ({request}), as the neighbouring test expects");
            result.GetProperty("errorCode").GetString().Should().Be(RefusedCode,
                $"SCENARIO: and it is refused with this code ({request})");
        }
    }

    /// <summary>
    /// The rule of plan CR-1a Task K2, applied to the response: the error code of every result whose status is the
    /// refused status, results with no code skipped, each code once, ordinal order, at most ten.
    /// </summary>
    private static string[] RefusedCodesIn(JsonElement results) =>
        results.EnumerateArray()
            .Where(r => r.GetProperty("status").GetString() == Refused)
            .Select(r => r.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String
                ? code.GetString()
                : null)
            .Where(code => code is not null)
            .Select(code => code!)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(code => code, StringComparer.Ordinal)
            .Take(10)
            .ToArray();

    /// <summary>One line per result, in the order the server returned them: what the app would act on, without ids.</summary>
    private static List<string> ShapeOf(string body)
    {
        using var doc = JsonDocument.Parse(body);

        return doc.RootElement.GetProperty("results").EnumerateArray()
            .Select(r =>
            {
                var code = r.TryGetProperty("errorCode", out var c) && c.ValueKind == JsonValueKind.String
                    ? c.GetString()
                    : "(none)";
                var keys = string.Join(",", r.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));

                return $"{r.GetProperty("clientRequestId").GetString()} | {r.GetProperty("mutationType").GetString()} | "
                    + $"{r.GetProperty("status").GetString()} | {code} | {keys}";
            })
            .ToList();
    }

    private static void ShouldNameNothing(Seen seen, string why)
    {
        seen.Path.Should().Be("/sync/push");
        seen.StatusCode.Should().Be(200);

        (seen.Codes ?? Array.Empty<string>()).Should().BeEmpty(
            $"{why}, so the route names no refused code on it (the push tagged \"{seen.Tag}\")");
        (seen.CodesStamped && seen.Codes is null).Should().BeFalse(
            $"{why}, so nothing is stamped on it; found an item of type {seen.CodesType}");
    }

    // ------------------------------------------------------------------
    // What the server recorded
    // ------------------------------------------------------------------

    /// <summary>
    /// Every row emitted so far. The middleware's emit is fire-and-forget by design, so this waits for the refused
    /// row (or gives up after five seconds) and then leaves the same grace period the middleware's own tests use, in
    /// which a second row would have landed.
    /// </summary>
    private static async Task<List<AnalyticsEvent>> SettledRowsAsync(CapturingWriter writer)
    {
        for (var i = 0; i < 200 && !writer.Snapshot().Any(e => e.EventType == RefusedSyncRow); i++)
        {
            await Task.Delay(25);
        }

        await Task.Delay(300);
        return writer.Snapshot();
    }

    private static string Dump(IReadOnlyCollection<AnalyticsEvent> rows) =>
        rows.Count == 0
            ? "(none)"
            : string.Join("\n", rows.Select(r => $"  {r.EventType}  {r.PropsJson}"));

    private sealed class CapturingWriter : IAnalyticsWriter
    {
        private readonly List<AnalyticsEvent> _events = new();

        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
        {
            lock (_events) { _events.Add(analyticsEvent); }
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
        {
            lock (_events) { _events.AddRange(events); }
            return Task.CompletedTask;
        }

        public List<AnalyticsEvent> Snapshot()
        {
            lock (_events) { return _events.ToList(); }
        }
    }

    // ------------------------------------------------------------------
    // What the route left on the request
    // ------------------------------------------------------------------

    /// <summary>One request, as the outermost middleware saw it after everything inside it had finished.</summary>
    private sealed record Seen(
        string Tag,
        string Method,
        string Path,
        int StatusCode,
        bool CodesStamped,
        string[]? Codes,
        string? CodesType);

    private sealed class Witness
    {
        private readonly List<Seen> _seen = new();

        public void Record(HttpContext ctx)
        {
            var stamped = ctx.Items.TryGetValue(RequestObservabilityKeys.RejectedWorkCodes, out var item)
                && item is not null;

            // The codes are copied: what is asserted is what was on the request when it ended.
            var seen = new Seen(
                Tag: ctx.Request.Headers[TagHeader].ToString(),
                Method: ctx.Request.Method,
                Path: ctx.Request.Path.Value ?? string.Empty,
                StatusCode: ctx.Response.StatusCode,
                CodesStamped: stamped,
                Codes: (item as IEnumerable<string>)?.ToArray(),
                CodesType: item?.GetType().FullName);

            lock (_seen) { _seen.Add(seen); }
        }

        /// <summary>The one request that carried this tag. Waits for it: the response can reach the caller first.</summary>
        public async Task<Seen> OfAsync(string tag)
        {
            for (var i = 0; i < 200; i++)
            {
                List<Seen> hits;
                lock (_seen) { hits = _seen.Where(s => s.Tag == tag).ToList(); }

                if (hits.Count > 0)
                {
                    hits.Should().ContainSingle($"HARNESS: each tag is sent once, so \"{tag}\" is seen once");
                    return hits[0];
                }

                await Task.Delay(25);
            }

            Assert.Fail(
                $"HARNESS: the request tagged \"{tag}\" never passed the witness, so the startup filter was not applied "
                + "to this host. This is not the stamp failing.");
            throw new InvalidOperationException("unreachable");
        }
    }

    /// <summary>
    /// Mounts the witness and, inside it, the server's own request middleware around the whole pipeline of a host this
    /// class did not build. ASP.NET Core applies every registered <see cref="IStartupFilter"/> when the host starts.
    /// </summary>
    private sealed class AroundTheRealPipeline(Witness witness) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (HttpContext ctx, RequestDelegate inner) =>
            {
                try
                {
                    await inner(ctx);
                }
                finally
                {
                    witness.Record(ctx);
                }
            });

            app.UseMiddleware<RequestObservabilityMiddleware>();

            next(app);
        };
    }
}

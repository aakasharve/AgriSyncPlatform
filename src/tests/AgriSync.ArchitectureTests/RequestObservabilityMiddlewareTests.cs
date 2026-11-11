using System.Text.Json;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Proves the WIRING, not just the parts. Task 1 stamps, Task 4 builds; this
/// asserts that a stamped result executed through the real middleware produces
/// a row that names the error — and that an exception escaping the endpoint
/// produces a row at all, which it does not today.
/// </summary>
public sealed class RequestObservabilityMiddlewareTests
{
    private sealed class CapturingWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();

        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            lock (Events) { Events.Add(e); }
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> es, CancellationToken ct = default)
        {
            lock (Events) { Events.AddRange(es); }
            return Task.CompletedTask;
        }
    }

    private static (RequestObservabilityMiddleware Mw, CapturingWriter Writer) Build(RequestDelegate next)
    {
        var writer = new CapturingWriter();
        var services = new ServiceCollection();
        services.AddScoped<IAnalyticsWriter>(_ => writer);
        var provider = services.BuildServiceProvider();

        var mw = new RequestObservabilityMiddleware(
            next,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RequestObservabilityMiddleware>.Instance);

        return (mw, writer);
    }

    /// <summary>
    /// The emit is fire-and-forget (Task.Run) by design — observability must
    /// never hold up a farmer's request — so poll rather than sleep a fixed time.
    /// </summary>
    private static async Task<AnalyticsEvent?> WaitForEvent(CapturingWriter w)
    {
        for (var i = 0; i < 200; i++)
        {
            lock (w.Events) { if (w.Events.Count > 0) return w.Events[0]; }
            await Task.Delay(25);
        }
        return null;
    }

    private static DefaultHttpContext WriteContext() => new()
    {
        Response = { Body = new MemoryStream() },
        RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        Request = { Method = "POST", Path = "/shramsafal/logs" },
    };

    [Fact]
    public async Task A_stamped_error_result_produces_a_row_that_names_the_error()
    {
        var error = ShramSafal.Domain.Common.ShramSafalErrors.CropCycleOverlap;

        var (mw, writer) = Build(async ctx =>
            await ErrorCapture.Stamp(error, Results.Conflict(new { error = error.Code }))
                .ExecuteAsync(ctx));

        await mw.InvokeAsync(WriteContext());

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull();
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("ShramSafal.CropCycleOverlap",
            "the endpoint knew which error it was answering; the record has to know too");
        props["statusCode"].GetInt32().Should().Be(409);
        props["workKept"].GetString().Should().Be("unknown");
    }

    [Fact]
    public async Task An_exception_escaping_the_endpoint_produces_a_row_naming_its_type()
    {
        // Before 2026-08-30 this produced NOTHING: InvokeAsync had no try, and
        // UseExceptionHandler is registered outside this middleware
        // (Program.cs:542 vs :581), so the exception unwound past every line
        // that builds and emits the event.
        var (mw, writer) = Build(_ => throw new InvalidOperationException("boom"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => mw.InvokeAsync(WriteContext()));

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull("an unhandled exception is the failure a developer most needs recorded");

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev!.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("Exception:InvalidOperationException");
        props["statusCode"].GetInt32().Should().Be(500,
            "the response had not been written when the exception passed through, so the "
            + "status is asserted from the exception rather than read from ctx.Response");
        props.Should().NotContainKey("exceptionMessage",
            "analytics.events is append-only and an exception message can carry the payload");
    }

    /// <summary>
    /// The claim this whole task rests on, proved through the REAL pipeline
    /// rather than by calling InvokeAsync directly: an exception thrown by an
    /// endpoint produces (a) an analytics row naming its type and (b) a 500
    /// written by the handler that is registered OUTSIDE this middleware.
    ///
    /// <para>
    /// Both halves matter and neither implies the other. Recording the failure
    /// must not swallow it — if the catch did not rethrow, the row would appear
    /// and the farmer would get a hung request or a 200. If the middleware did
    /// not catch at all (the state before 2026-08-31) the 500 would appear and
    /// the row would not. The pipeline here is assembled in the same ORDER as
    /// Program.cs:542/:581 — UseExceptionHandler first, so it sits further out —
    /// because that ordering is precisely what made the emit unreachable.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_exception_is_recorded_AND_still_reaches_the_upstream_handler()
    {
        var writer = new CapturingWriter();

        using var host = await new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddLogging();
                    services.AddProblemDetails();
                    services.AddExceptionHandler<GlobalExceptionHandler>();
                    services.AddScoped<IAnalyticsWriter>(_ => writer);
                })
                .Configure(app =>
                {
                    // Same order as Program.cs — the handler is registered
                    // first, so it wraps the observability middleware.
                    app.UseExceptionHandler();
                    app.UseMiddleware<RequestObservabilityMiddleware>();
                    app.Run(_ => throw new InvalidOperationException(
                        "farmer transcript that must never be recorded"));
                }))
            .StartAsync();

        var response = await host.GetTestClient()
            .PostAsync("/shramsafal/logs", new StringContent(string.Empty));

        // (b) The exception was not swallowed: it propagated out of this
        // middleware and GlobalExceptionHandler produced the 500.
        ((int)response.StatusCode).Should().Be(500,
            "the catch rethrows — recording a failure must never consume it");

        // (a) And it was recorded, which before this task it was not.
        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull(
            "an endpoint that crashed is the failure a developer most needs recorded, and "
            + "until 2026-08-31 it produced no row at all");
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("Exception:InvalidOperationException");
        props["statusCode"].GetInt32().Should().Be(500);
        props["workKept"].GetString().Should().Be("unknown",
            "nothing observed whether the write survived, and 'kept' is never inferred");

        // The exception MESSAGE stands in for a farmer's own words here. It may
        // not appear anywhere in the row: analytics.events is append-only
        // (DO INSTEAD NOTHING on UPDATE/DELETE), so it could never be scrubbed.
        ev.PropsJson.Should().NotContain("farmer transcript");
        ev.PropsJson.Should().NotContain("must never be recorded");
    }

    [Fact]
    public async Task A_cancelled_request_is_not_reported_as_a_server_failure()
    {
        // A farmer on Jio closing the tab is not a 500. GlobalExceptionHandler
        // makes the same distinction (returns false for a cancelled request).
        var (mw, writer) = Build(_ => throw new OperationCanceledException());

        var ctx = WriteContext();
        ctx.RequestAborted = new CancellationToken(canceled: true);

        await Assert.ThrowsAsync<OperationCanceledException>(() => mw.InvokeAsync(ctx));

        await Task.Delay(300);
        lock (writer.Events) { writer.Events.Should().BeEmpty(); }
    }
}

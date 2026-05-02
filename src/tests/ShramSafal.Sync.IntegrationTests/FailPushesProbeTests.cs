using System;
using System.Collections.Generic;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ShramSafal.Application.Abstractions.Sync;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Sub-plan 05 Task 2a (T-IGH-05-FAIL-PUSHES-WIRING).
/// Verifies that <c>PushSyncBatchHandler</c> consults <see cref="IE2eFailPushesProbe"/>
/// and short-circuits per-mutation when the probe reports a failure reason.
/// </summary>
[Trait("Category", "FailPushesProbe")]
public sealed class FailPushesProbeTests
{
    // -----------------------------------------------------------------------
    // Helper: a mutable probe that tests control directly.
    // -----------------------------------------------------------------------
    private sealed class MutableProbe : IE2eFailPushesProbe
    {
        public string? FailReason { get; set; }
    }

    // -----------------------------------------------------------------------
    // Test 1: probe returns null → push succeeds
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Push_WhenProbeReturnsNull_MutationIsApplied()
    {
        var probe = new MutableProbe { FailReason = null };

        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync(services =>
        {
            services.RemoveAll<IE2eFailPushesProbe>();
            services.AddSingleton<IE2eFailPushesProbe>(probe);
        });

        var farmId = Guid.NewGuid();
        var response = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "probe-device-null",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "probe-req-null-1",
                    mutationType = "create_farm",
                    payload = new { farmId, name = "ProbeNull Farm" }
                }
            }
        });

        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var status = doc.RootElement
            .GetProperty("results")[0]
            .GetProperty("status")
            .GetString();

        Assert.Equal("applied", status);
    }

    // -----------------------------------------------------------------------
    // Test 2: probe returns "TEST_REASON" → every mutation gets failed result
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Push_WhenProbeReturnsReason_EachMutationIsFailed_WithThatReason()
    {
        const string testReason = "TEST_REASON";
        var probe = new MutableProbe { FailReason = testReason };

        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync(services =>
        {
            services.RemoveAll<IE2eFailPushesProbe>();
            services.AddSingleton<IE2eFailPushesProbe>(probe);
        });

        var farmId1 = Guid.NewGuid();
        var farmId2 = Guid.NewGuid();

        var response = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "probe-device-set",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "probe-req-set-1",
                    mutationType = "create_farm",
                    payload = new { farmId = farmId1, name = "ProbeSet Farm 1" }
                },
                new
                {
                    clientRequestId = "probe-req-set-2",
                    mutationType = "create_farm",
                    payload = new { farmId = farmId2, name = "ProbeSet Farm 2" }
                }
            }
        });

        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var results = doc.RootElement.GetProperty("results");

        Assert.Equal(2, results.GetArrayLength());
        foreach (var result in results.EnumerateArray())
        {
            var status = result.GetProperty("status").GetString();
            var errorMessage = result.GetProperty("errorMessage").GetString();
            Assert.Equal("failed", status);
            Assert.NotNull(errorMessage);
            Assert.Contains(testReason, errorMessage, StringComparison.Ordinal);
        }
    }

    // -----------------------------------------------------------------------
    // Test 3: probe flips set → null between two batches
    //         first batch fails, second batch succeeds
    // -----------------------------------------------------------------------
    [Fact]
    public async Task Push_WhenProbeFlipsFromSetToNull_FirstBatchFails_SecondBatchSucceeds()
    {
        const string testReason = "TRANSIENT_REASON";
        var probe = new MutableProbe { FailReason = testReason };

        await using var harness = await SyncEndpointsTests.TestHarness.CreateAsync(services =>
        {
            services.RemoveAll<IE2eFailPushesProbe>();
            services.AddSingleton<IE2eFailPushesProbe>(probe);
        });

        var farmId1 = Guid.NewGuid();

        // --- First batch: probe is set → expect failure ---
        var firstResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "probe-device-flip",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "probe-req-flip-1",
                    mutationType = "create_farm",
                    payload = new { farmId = farmId1, name = "ProbeFlip Farm 1" }
                }
            }
        });

        firstResponse.EnsureSuccessStatusCode();
        using var firstDoc = JsonDocument.Parse(await firstResponse.Content.ReadAsStringAsync());
        var firstStatus = firstDoc.RootElement
            .GetProperty("results")[0]
            .GetProperty("status")
            .GetString();
        Assert.Equal("failed", firstStatus);

        // --- Clear the probe ---
        probe.FailReason = null;

        var farmId2 = Guid.NewGuid();

        // --- Second batch: probe is null → expect success ---
        var secondResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "probe-device-flip",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "probe-req-flip-2",
                    mutationType = "create_farm",
                    payload = new { farmId = farmId2, name = "ProbeFlip Farm 2" }
                }
            }
        });

        secondResponse.EnsureSuccessStatusCode();
        using var secondDoc = JsonDocument.Parse(await secondResponse.Content.ReadAsStringAsync());
        var secondStatus = secondDoc.RootElement
            .GetProperty("results")[0]
            .GetProperty("status")
            .GetString();
        Assert.Equal("applied", secondStatus);
    }
}

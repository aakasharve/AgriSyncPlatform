using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ShramSafal.Api;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

public sealed class SyncEndpointsTests
{
    [Fact]
    public async Task Push_WithDuplicateClientRequestId_PerDevice_IsIdempotent()
    {
        await using var harness = await TestHarness.CreateAsync();
        var deviceId = "device-a";
        var farmId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();

        var firstPush = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId,
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-1",
                    mutationType = "create_farm",
                    payload = new
                    {
                        farmId,
                        name = "Idempotent Farm",
                        ownerUserId = ownerId
                    }
                }
            }
        });

        firstPush.EnsureSuccessStatusCode();

        var firstStatus = await ReadFirstPushStatusAsync(firstPush);
        Assert.Equal("applied", firstStatus);

        var duplicatePush = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId,
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-1",
                    mutationType = "create_farm",
                    payload = new
                    {
                        farmId,
                        name = "Idempotent Farm",
                        ownerUserId = ownerId
                    }
                }
            }
        });

        duplicatePush.EnsureSuccessStatusCode();

        var duplicateStatus = await ReadFirstPushStatusAsync(duplicatePush);
        Assert.Equal("duplicate", duplicateStatus);

        var pull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"))}");
        pull.EnsureSuccessStatusCode();

        using var pullDoc = JsonDocument.Parse(await pull.Content.ReadAsStringAsync());
        var farms = pullDoc.RootElement.GetProperty("farms")
            .EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid())
            .ToList();

        Assert.Single(farms, id => id == farmId);
    }

    [Fact]
    public async Task Pull_WithCursor_ReturnsOnlyDeltas()
    {
        await using var harness = await TestHarness.CreateAsync();
        var ownerId = Guid.NewGuid();

        var farm1 = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-b", "req-farm-1", farm1, ownerId, "Cursor Farm 1");

        var firstPull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"))}");
        firstPull.EnsureSuccessStatusCode();

        using var firstPullDoc = JsonDocument.Parse(await firstPull.Content.ReadAsStringAsync());
        var firstCursor = firstPullDoc.RootElement.GetProperty("nextCursorUtc").GetDateTime();
        var firstFarmIds = firstPullDoc.RootElement.GetProperty("farms")
            .EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid())
            .ToList();
        Assert.Contains(farm1, firstFarmIds);

        await Task.Delay(20);

        var farm2 = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-b", "req-farm-2", farm2, ownerId, "Cursor Farm 2");

        var secondPull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(firstCursor.ToString("O"))}");
        secondPull.EnsureSuccessStatusCode();

        using var secondPullDoc = JsonDocument.Parse(await secondPull.Content.ReadAsStringAsync());
        var secondCursor = secondPullDoc.RootElement.GetProperty("nextCursorUtc").GetDateTime();
        var secondFarmIds = secondPullDoc.RootElement.GetProperty("farms")
            .EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid())
            .ToList();

        Assert.Single(secondFarmIds);
        Assert.Equal(farm2, secondFarmIds[0]);

        var thirdPull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(secondCursor.ToString("O"))}");
        thirdPull.EnsureSuccessStatusCode();

        using var thirdPullDoc = JsonDocument.Parse(await thirdPull.Content.ReadAsStringAsync());
        var thirdFarms = thirdPullDoc.RootElement.GetProperty("farms").EnumerateArray().ToList();
        Assert.Empty(thirdFarms);
    }

    private static async Task PushCreateFarmAsync(
        HttpClient client,
        string deviceId,
        string requestId,
        Guid farmId,
        Guid ownerUserId,
        string name)
    {
        var response = await client.PostAsJsonAsync("/sync/push", new
        {
            deviceId,
            mutations = new[]
            {
                new
                {
                    clientRequestId = requestId,
                    mutationType = "create_farm",
                    payload = new
                    {
                        farmId,
                        name,
                        ownerUserId
                    }
                }
            }
        });

        response.EnsureSuccessStatusCode();
    }

    private static async Task<string?> ReadFirstPushStatusAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("results")[0].GetProperty("status").GetString();
    }

    private sealed class TestHarness(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test"
            });

            builder.Services.AddBuildingBlocks();
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"sync-tests-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            var app = builder.Build();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new TestHarness(app, client);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}

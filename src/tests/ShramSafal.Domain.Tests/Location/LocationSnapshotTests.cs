using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Location;

public sealed class LocationSnapshotTests
{
    [Fact]
    public void DailyLog_WithLocation_AttachLocation_StoresSnapshot()
    {
        var log = CreateLog();
        var location = BuildLocation();

        log.AttachLocation(location);

        Assert.NotNull(log.Location);
        Assert.Equal(location.Latitude, log.Location!.Latitude);
        Assert.Equal(location.Longitude, log.Location.Longitude);
        Assert.Equal(location.Provider, log.Location.Provider);
    }

    [Fact]
    public void DailyLog_WithoutLocation_WorksFine()
    {
        var log = CreateLog();

        Assert.Null(log.Location);
    }

    [Fact]
    public void AttachLocation_WhenAlreadySet_Throws()
    {
        var log = CreateLog();
        log.AttachLocation(BuildLocation());

        var ex = Assert.Throws<InvalidOperationException>(() => log.AttachLocation(BuildLocation()));
        Assert.Contains("immutable", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SyncPull_WithLocation_DeserializesLocationSnapshot()
    {
        const string json = """
{
  "serverTimeUtc": "2026-02-22T00:00:00Z",
  "nextCursorUtc": "2026-02-22T00:00:00Z",
  "farms": [],
  "plots": [],
  "cropCycles": [],
  "dailyLogs": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "farmId": "22222222-2222-2222-2222-222222222222",
      "plotId": "33333333-3333-3333-3333-333333333333",
      "cropCycleId": "44444444-4444-4444-4444-444444444444",
      "operatorUserId": "55555555-5555-5555-5555-555555555555",
      "logDate": "2026-02-22",
      "idempotencyKey": "device-a:req-1",
      "createdAtUtc": "2026-02-22T00:00:00Z",
      "verificationStatus": "draft",
      "tasks": [],
      "verificationEvents": [],
      "location": {
        "latitude": 18.5204,
        "longitude": 73.8567,
        "accuracyMeters": 10.5,
        "altitude": 560.0,
        "capturedAtUtc": "2026-02-22T09:00:00Z",
        "provider": "gps",
        "permissionState": "granted"
      }
    }
  ],
  "costEntries": [],
  "financeCorrections": [],
  "priceConfigs": [],
  "dayLedgers": [],
  "plannedActivities": []
}
""";

        var payload = JsonSerializer.Deserialize<SyncPullResponseDto>(
            json,
            new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

        Assert.NotNull(payload);
        Assert.Single(payload!.DailyLogs);
        var location = payload.DailyLogs[0].Location;
        Assert.NotNull(location);
        Assert.Equal(18.5204m, location!.Latitude);
        Assert.Equal("gps", location.Provider);
    }

    private static DailyLog CreateLog()
    {
        return DailyLog.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            DateOnly.FromDateTime(DateTime.UtcNow),
            null,
            DateTime.UtcNow);
    }

    private static LocationSnapshot BuildLocation()
    {
        return new LocationSnapshot
        {
            Latitude = 18.5204m,
            Longitude = 73.8567m,
            AccuracyMeters = 10.5m,
            Altitude = 560.0m,
            CapturedAtUtc = DateTime.UtcNow,
            Provider = "gps",
            PermissionState = "granted",
        };
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

public sealed class SyncEndpointsTests
{
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task Push_WithDuplicateClientRequestId_PerDevice_IsIdempotent()
    {
        await using var harness = await TestHarness.CreateAsync();
        var deviceId = "device-a";
        var farmId = Guid.NewGuid();

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
                        name = "Idempotent Farm"
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
                        name = "Idempotent Farm"
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
        var farm1 = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-b", "req-farm-1", farm1, "Cursor Farm 1");

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
        await PushCreateFarmAsync(harness.Client, "device-b", "req-farm-2", farm2, "Cursor Farm 2");

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

    [Fact]
    public async Task Push_CreateAttachmentMutation_IsApplied_AndIncludedInPull()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var attachmentId = Guid.NewGuid();
        var spoofedUserId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-c", "req-farm-attachment", farmId, "Attachment Farm");

        var attachmentPush = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-c",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-attachment-1",
                    mutationType = "create_attachment",
                    payload = new
                    {
                        attachmentId,
                        farmId,
                        linkedEntityId = farmId,
                        linkedEntityType = "Farm",
                        fileName = "receipt.jpg",
                        mimeType = "image/jpeg",
                        createdByUserId = spoofedUserId
                    }
                }
            }
        });

        attachmentPush.EnsureSuccessStatusCode();
        var status = await ReadFirstPushStatusAsync(attachmentPush);
        Assert.Equal("applied", status);

        var pull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"))}");
        pull.EnsureSuccessStatusCode();

        using var pullDoc = JsonDocument.Parse(await pull.Content.ReadAsStringAsync());
        var attachments = pullDoc.RootElement.GetProperty("attachments").EnumerateArray().ToList();
        var attachment = attachments.Single(x => x.GetProperty("id").GetGuid() == attachmentId);

        Assert.Equal(TestUserId, attachment.GetProperty("createdByUserId").GetGuid());

        var auditResponse = await harness.Client.GetAsync($"/shramsafal/audit?entityType=Attachment&entityId={attachmentId}");
        auditResponse.EnsureSuccessStatusCode();

        using var auditDoc = JsonDocument.Parse(await auditResponse.Content.ReadAsStringAsync());
        var createdEvent = auditDoc.RootElement
            .EnumerateArray()
            .Single(x => x.GetProperty("action").GetString() == "Created");

        Assert.Equal(TestUserId, createdEvent.GetProperty("actorUserId").GetGuid());
    }

    [Fact]
    public async Task UploadAttachment_WritesAuditEvent()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-d", "req-farm-upload-audit", farmId, "Upload Audit Farm");

        var createResponse = await harness.Client.PostAsJsonAsync("/shramsafal/attachments", new
        {
            farmId,
            linkedEntityId = farmId,
            linkedEntityType = "Farm",
            fileName = "proof.jpg",
            mimeType = "image/jpeg"
        });

        createResponse.EnsureSuccessStatusCode();
        using var createDoc = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var attachmentId = createDoc.RootElement
            .GetProperty("attachment")
            .GetProperty("id")
            .GetGuid();

        using var multipart = new MultipartFormDataContent();
        var imageContent = new ByteArrayContent(new byte[] { 1, 2, 3, 4, 5, 6 });
        imageContent.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        multipart.Add(imageContent, "file", "proof.jpg");

        var uploadResponse = await harness.Client.PostAsync($"/shramsafal/attachments/{attachmentId}/upload", multipart);
        uploadResponse.EnsureSuccessStatusCode();

        var auditResponse = await harness.Client.GetAsync($"/shramsafal/audit?entityType=Attachment&entityId={attachmentId}");
        auditResponse.EnsureSuccessStatusCode();

        using var auditDoc = JsonDocument.Parse(await auditResponse.Content.ReadAsStringAsync());
        var uploadedEvent = auditDoc.RootElement
            .EnumerateArray()
            .Single(x => x.GetProperty("action").GetString() == "UploadedAndFinalized");

        Assert.Equal(TestUserId, uploadedEvent.GetProperty("actorUserId").GetGuid());
    }

    [Fact]
    public async Task Push_AllocateGlobalExpenseMutation_IsApplied_AndIncludedInPull()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var plotAId = Guid.NewGuid();
        var plotBId = Guid.NewGuid();
        var costEntryId = Guid.NewGuid();
        var dayLedgerId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-e", "req-farm-day-ledger", farmId, "Day Ledger Farm");

        var createPlotsResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-e",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-a",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId = plotAId,
                        farmId,
                        name = "North Plot",
                        areaInAcres = 2m
                    }
                },
                new
                {
                    clientRequestId = "req-plot-b",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId = plotBId,
                        farmId,
                        name = "South Plot",
                        areaInAcres = 1m
                    }
                }
            }
        });
        createPlotsResponse.EnsureSuccessStatusCode();

        var createCostEntryResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-e",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-cost-entry",
                    mutationType = "add_cost_entry",
                    payload = new
                    {
                        costEntryId,
                        farmId,
                        category = "SharedLabour",
                        description = "Shared wages",
                        amount = 1200m,
                        currencyCode = "INR",
                        entryDate = "2026-02-22"
                    }
                }
            }
        });
        createCostEntryResponse.EnsureSuccessStatusCode();

        var allocateResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-e",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-allocate",
                    mutationType = "allocate_global_expense",
                    payload = new
                    {
                        dayLedgerId,
                        costEntryId,
                        allocationBasis = "equal",
                        allocations = Array.Empty<object>(),
                        createdByUserId = Guid.NewGuid()
                    }
                }
            }
        });

        allocateResponse.EnsureSuccessStatusCode();
        var status = await ReadFirstPushStatusAsync(allocateResponse);
        Assert.Equal("applied", status);

        var pull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"))}");
        pull.EnsureSuccessStatusCode();

        using var pullDoc = JsonDocument.Parse(await pull.Content.ReadAsStringAsync());
        var dayLedgers = pullDoc.RootElement.GetProperty("dayLedgers").EnumerateArray().ToList();
        var dayLedger = dayLedgers.Single(x => x.GetProperty("id").GetGuid() == dayLedgerId);
        var allocations = dayLedger.GetProperty("allocations").EnumerateArray().ToList();

        Assert.Equal(costEntryId, dayLedger.GetProperty("sourceCostEntryId").GetGuid());
        Assert.Equal("equal", dayLedger.GetProperty("allocationBasis").GetString());
        Assert.Equal(2, allocations.Count);
        Assert.Equal(TestUserId, dayLedger.GetProperty("createdByUserId").GetGuid());

        var auditResponse = await harness.Client.GetAsync($"/shramsafal/audit?entityType=DayLedger&entityId={dayLedgerId}");
        auditResponse.EnsureSuccessStatusCode();

        using var auditDoc = JsonDocument.Parse(await auditResponse.Content.ReadAsStringAsync());
        var allocatedEvent = auditDoc.RootElement
            .EnumerateArray()
            .Single(x => x.GetProperty("action").GetString() == "Allocated");

        Assert.Equal(TestUserId, allocatedEvent.GetProperty("actorUserId").GetGuid());
    }

    [Fact]
    public async Task Push_SpoofedUserIds_AreIgnored_AndJwtActorIsUsed()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var dailyLogId = Guid.NewGuid();
        var costEntryId = Guid.NewGuid();
        var spoofedUserId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-f", "req-farm-jwt-claims", farmId, "JWT Claims Farm");

        var setupResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-f",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-jwt",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId,
                        farmId,
                        name = "JWT Plot",
                        areaInAcres = 1.5m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-jwt",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId,
                        farmId,
                        plotId,
                        cropName = "Grapes",
                        stage = "Growth",
                        startDate = "2026-02-20"
                    }
                },
                new
                {
                    clientRequestId = "req-log-jwt",
                    mutationType = "create_daily_log",
                    payload = new
                    {
                        dailyLogId,
                        farmId,
                        plotId,
                        cropCycleId,
                        operatorUserId = spoofedUserId,
                        logDate = "2026-02-22"
                    }
                },
                new
                {
                    clientRequestId = "req-cost-jwt",
                    mutationType = "add_cost_entry",
                    payload = new
                    {
                        costEntryId,
                        farmId,
                        category = "Labour",
                        description = "Spoofed createdBy attempt",
                        amount = 500m,
                        currencyCode = "INR",
                        entryDate = "2026-02-22",
                        createdByUserId = spoofedUserId
                    }
                },
                new
                {
                    clientRequestId = "req-verify-jwt",
                    mutationType = "verify_log",
                    payload = new
                    {
                        dailyLogId,
                        status = "Approved",
                        verifiedByUserId = spoofedUserId
                    }
                }
            }
        });

        setupResponse.EnsureSuccessStatusCode();

        using var setupDoc = JsonDocument.Parse(await setupResponse.Content.ReadAsStringAsync());
        var failures = setupDoc.RootElement
            .GetProperty("results")
            .EnumerateArray()
            .Where(x => x.GetProperty("status").GetString() == "failed")
            .ToList();
        Assert.Empty(failures);

        var pull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"))}");
        pull.EnsureSuccessStatusCode();

        using var pullDoc = JsonDocument.Parse(await pull.Content.ReadAsStringAsync());
        var dailyLog = pullDoc.RootElement
            .GetProperty("dailyLogs")
            .EnumerateArray()
            .Single(x => x.GetProperty("id").GetGuid() == dailyLogId);
        var costEntry = pullDoc.RootElement
            .GetProperty("costEntries")
            .EnumerateArray()
            .Single(x => x.GetProperty("id").GetGuid() == costEntryId);
        var latestVerification = dailyLog
            .GetProperty("verificationEvents")
            .EnumerateArray()
            .OrderByDescending(x => x.GetProperty("occurredAtUtc").GetDateTime())
            .First();

        Assert.Equal(TestUserId, dailyLog.GetProperty("operatorUserId").GetGuid());
        Assert.Equal(TestUserId, costEntry.GetProperty("createdByUserId").GetGuid());
        Assert.Equal(TestUserId, latestVerification.GetProperty("verifiedByUserId").GetGuid());
    }

    [Fact]
    public async Task CreateAttachment_CanLinkToDailyLogAndCostEntry()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var dailyLogId = Guid.NewGuid();
        var costEntryId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-g", "req-farm-attachment-link", farmId, "Attachment Link Farm");

        var setupResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-g",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-link",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId,
                        farmId,
                        name = "Link Plot",
                        areaInAcres = 2m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-link",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId,
                        farmId,
                        plotId,
                        cropName = "Onion",
                        stage = "Planting",
                        startDate = "2026-02-21"
                    }
                },
                new
                {
                    clientRequestId = "req-log-link",
                    mutationType = "create_daily_log",
                    payload = new
                    {
                        dailyLogId,
                        farmId,
                        plotId,
                        cropCycleId,
                        logDate = "2026-02-22"
                    }
                },
                new
                {
                    clientRequestId = "req-cost-link",
                    mutationType = "add_cost_entry",
                    payload = new
                    {
                        costEntryId,
                        farmId,
                        category = "Input",
                        description = "Fertilizer",
                        amount = 1000m,
                        currencyCode = "INR",
                        entryDate = "2026-02-22"
                    }
                }
            }
        });
        setupResponse.EnsureSuccessStatusCode();

        var logAttachmentResponse = await harness.Client.PostAsJsonAsync("/shramsafal/attachments", new
        {
            farmId,
            linkedEntityId = dailyLogId,
            linkedEntityType = "dailylog",
            fileName = "log-proof.jpg",
            mimeType = "image/jpeg"
        });
        logAttachmentResponse.EnsureSuccessStatusCode();

        var costAttachmentResponse = await harness.Client.PostAsJsonAsync("/shramsafal/attachments", new
        {
            farmId,
            linkedEntityId = costEntryId,
            linkedEntityType = "costentry",
            fileName = "invoice.jpg",
            mimeType = "image/jpeg"
        });
        costAttachmentResponse.EnsureSuccessStatusCode();

        var listLogAttachments = await harness.Client.GetAsync($"/shramsafal/attachments?entityId={dailyLogId}&entityType=DailyLog");
        listLogAttachments.EnsureSuccessStatusCode();
        using var logListDoc = JsonDocument.Parse(await listLogAttachments.Content.ReadAsStringAsync());
        Assert.Single(logListDoc.RootElement.EnumerateArray());

        var listCostAttachments = await harness.Client.GetAsync($"/shramsafal/attachments?entityId={costEntryId}&entityType=CostEntry");
        listCostAttachments.EnsureSuccessStatusCode();
        using var costListDoc = JsonDocument.Parse(await listCostAttachments.Content.ReadAsStringAsync());
        Assert.Single(costListDoc.RootElement.EnumerateArray());
    }

    [Fact]
    public async Task CreateAttachment_RejectsCrossFarmEntityLink()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmAId = Guid.NewGuid();
        var farmBId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var dailyLogId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-h", "req-farm-a", farmAId, "Farm A");
        await PushCreateFarmAsync(harness.Client, "device-h", "req-farm-b", farmBId, "Farm B");

        var setupResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-h",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-a",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId,
                        farmId = farmAId,
                        name = "Farm A Plot",
                        areaInAcres = 1m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-a",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId,
                        farmId = farmAId,
                        plotId,
                        cropName = "Tomato",
                        stage = "Vegetative",
                        startDate = "2026-02-10"
                    }
                },
                new
                {
                    clientRequestId = "req-log-a",
                    mutationType = "create_daily_log",
                    payload = new
                    {
                        dailyLogId,
                        farmId = farmAId,
                        plotId,
                        cropCycleId,
                        logDate = "2026-02-22"
                    }
                }
            }
        });
        setupResponse.EnsureSuccessStatusCode();

        var invalidAttachmentResponse = await harness.Client.PostAsJsonAsync("/shramsafal/attachments", new
        {
            farmId = farmBId,
            linkedEntityId = dailyLogId,
            linkedEntityType = "DailyLog",
            fileName = "cross-farm.jpg",
            mimeType = "image/jpeg"
        });

        Assert.Equal(System.Net.HttpStatusCode.Forbidden, invalidAttachmentResponse.StatusCode);
    }

    [Fact]
    public async Task Push_CreatePlotAndCropCycle_WriteAuditEvents()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-i", "req-farm-audit-plot-cycle", farmId, "Audit Plot Cycle Farm");

        var pushResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-i",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-audit",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId,
                        farmId,
                        name = "Audit Plot",
                        areaInAcres = 3m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-audit",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId,
                        farmId,
                        plotId,
                        cropName = "Pomegranate",
                        stage = "Flowering",
                        startDate = "2026-02-22"
                    }
                }
            }
        });
        pushResponse.EnsureSuccessStatusCode();

        var plotAuditResponse = await harness.Client.GetAsync($"/shramsafal/audit?entityType=Plot&entityId={plotId}");
        plotAuditResponse.EnsureSuccessStatusCode();
        using var plotAuditDoc = JsonDocument.Parse(await plotAuditResponse.Content.ReadAsStringAsync());
        var plotCreated = plotAuditDoc.RootElement
            .EnumerateArray()
            .Single(x => x.GetProperty("action").GetString() == "Created");
        Assert.Equal(TestUserId, plotCreated.GetProperty("actorUserId").GetGuid());

        var cycleAuditResponse = await harness.Client.GetAsync($"/shramsafal/audit?entityType=CropCycle&entityId={cropCycleId}");
        cycleAuditResponse.EnsureSuccessStatusCode();
        using var cycleAuditDoc = JsonDocument.Parse(await cycleAuditResponse.Content.ReadAsStringAsync());
        var cycleCreated = cycleAuditDoc.RootElement
            .EnumerateArray()
            .Single(x => x.GetProperty("action").GetString() == "Created");
        Assert.Equal(TestUserId, cycleCreated.GetProperty("actorUserId").GetGuid());
    }

    [Fact]
    public async Task Push_SetPriceConfig_RequiresFarmMembership()
    {
        await using var harness = await TestHarness.CreateAsync();

        var withoutMembership = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-j",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-price-no-membership",
                    mutationType = "set_price_config",
                    payload = new
                    {
                        itemName = "Urea",
                        unitPrice = 350m,
                        currencyCode = "INR",
                        effectiveFrom = "2026-02-22",
                        version = 1
                    }
                }
            }
        });

        withoutMembership.EnsureSuccessStatusCode();
        using (var doc = JsonDocument.Parse(await withoutMembership.Content.ReadAsStringAsync()))
        {
            var result = doc.RootElement.GetProperty("results")[0];
            Assert.Equal("failed", result.GetProperty("status").GetString());
            Assert.Equal("ShramSafal.Forbidden", result.GetProperty("errorCode").GetString());
        }

        await PushCreateFarmAsync(harness.Client, "device-j", "req-price-farm", Guid.NewGuid(), "Membership Farm");

        var withMembership = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-j",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-price-with-membership",
                    mutationType = "set_price_config",
                    payload = new
                    {
                        itemName = "Urea",
                        unitPrice = 350m,
                        currencyCode = "INR",
                        effectiveFrom = "2026-02-22",
                        version = 1
                    }
                }
            }
        });

        withMembership.EnsureSuccessStatusCode();
        var status = await ReadFirstPushStatusAsync(withMembership);
        Assert.Equal("applied", status);
    }

    private static async Task PushCreateFarmAsync(
        HttpClient client,
        string deviceId,
        string requestId,
        Guid farmId,
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
                        name
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

    private sealed class TestHarness(WebApplication app, HttpClient client, string storageDirectory) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-sync-tests", Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDirectory
            });

            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"sync-tests-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new TestHarness(app, client, storageDirectory);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
            if (Directory.Exists(storageDirectory))
            {
                Directory.Delete(storageDirectory, recursive: true);
            }
        }
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new[]
            {
                new Claim("sub", TestUserId.ToString()),
                new Claim("membership", "shramsafal:PrimaryOwner")
            };

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
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
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests;
using ShramSafal.Infrastructure.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

public sealed class SyncEndpointsTests
{
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid SecondaryOwnerUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

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
        var imageContent = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 });
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
    public async Task UploadAttachment_RejectsMismatchedFileSignature()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-upload-signature", "req-farm-upload-signature", farmId, "Upload Signature Farm");

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
        var fakeJpeg = new ByteArrayContent(Encoding.UTF8.GetBytes("not-a-real-jpeg"));
        fakeJpeg.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        multipart.Add(fakeJpeg, "file", "proof.jpg");

        var uploadResponse = await harness.Client.PostAsync($"/shramsafal/attachments/{attachmentId}/upload", multipart);
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, uploadResponse.StatusCode);
    }

    [Fact]
    public async Task UploadAttachment_RejectsOversizedPayload()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-upload-size", "req-farm-upload-size", farmId, "Upload Size Farm");

        var createResponse = await harness.Client.PostAsJsonAsync("/shramsafal/attachments", new
        {
            farmId,
            linkedEntityId = farmId,
            linkedEntityType = "Farm",
            fileName = "large.pdf",
            mimeType = "application/pdf"
        });

        createResponse.EnsureSuccessStatusCode();
        using var createDoc = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var attachmentId = createDoc.RootElement
            .GetProperty("attachment")
            .GetProperty("id")
            .GetGuid();

        using var multipart = new MultipartFormDataContent();
        var oversized = new byte[(10 * 1024 * 1024) + 1];
        oversized[0] = 0x25;
        oversized[1] = 0x50;
        oversized[2] = 0x44;
        oversized[3] = 0x46;
        oversized[4] = 0x2D;

        var largePdf = new ByteArrayContent(oversized);
        largePdf.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        multipart.Add(largePdf, "file", "large.pdf");

        var uploadResponse = await harness.Client.PostAsync($"/shramsafal/attachments/{attachmentId}/upload", multipart);
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, uploadResponse.StatusCode);
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
    public async Task Push_CreateCropCycle_RejectsOverlapOnSamePlot()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var firstCycleId = Guid.NewGuid();
        var overlappingCycleId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-overlap", "req-farm-overlap", farmId, "Overlap Farm");

        var setupResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-overlap",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-overlap",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId,
                        farmId,
                        name = "Overlap Plot",
                        areaInAcres = 2m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-overlap-1",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId = firstCycleId,
                        farmId,
                        plotId,
                        cropName = "Grapes",
                        stage = "Growth",
                        startDate = "2026-01-01",
                        endDate = "2026-06-30"
                    }
                }
            }
        });
        setupResponse.EnsureSuccessStatusCode();

        var overlappingResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-overlap",
            mutations = new[]
            {
                new
                {
                    clientRequestId = "req-cycle-overlap-2",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId = overlappingCycleId,
                        farmId,
                        plotId,
                        cropName = "Onion",
                        stage = "Planting",
                        startDate = "2026-03-01",
                        endDate = "2026-07-01"
                    }
                }
            }
        });
        overlappingResponse.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await overlappingResponse.Content.ReadAsStringAsync());
        var result = doc.RootElement.GetProperty("results")[0];
        Assert.Equal("failed", result.GetProperty("status").GetString());
        Assert.Equal("ShramSafal.CropCycleOverlap", result.GetProperty("errorCode").GetString());
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

    [Fact]
    public async Task FarmMembership_IsFarmScoped_ForNonOwnerUser()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmAId = Guid.NewGuid();
        var farmBId = Guid.NewGuid();
        var plotAId = Guid.NewGuid();
        var plotBId = Guid.NewGuid();
        var cycleAId = Guid.NewGuid();
        var cycleBId = Guid.NewGuid();
        var logAId = Guid.NewGuid();
        var logBId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-scope", "req-farm-scope-a", farmAId, "Scoped Farm A");
        await PushCreateFarmAsync(harness.Client, "device-scope", "req-farm-scope-b", farmBId, "Scoped Farm B");

        var ownerSetupResponse = await harness.Client.PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-scope-owner",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-plot-scope-a",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId = plotAId,
                        farmId = farmAId,
                        name = "Scoped Plot A",
                        areaInAcres = 1.2m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-scope-a",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId = cycleAId,
                        farmId = farmAId,
                        plotId = plotAId,
                        cropName = "Grapes",
                        stage = "Growth",
                        startDate = "2026-03-01"
                    }
                },
                new
                {
                    clientRequestId = "req-plot-scope-b",
                    mutationType = "create_plot",
                    payload = new
                    {
                        plotId = plotBId,
                        farmId = farmBId,
                        name = "Scoped Plot B",
                        areaInAcres = 2.4m
                    }
                },
                new
                {
                    clientRequestId = "req-cycle-scope-b",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId = cycleBId,
                        farmId = farmBId,
                        plotId = plotBId,
                        cropName = "Onion",
                        stage = "Planting",
                        startDate = "2026-03-01"
                    }
                }
            }
        });
        ownerSetupResponse.EnsureSuccessStatusCode();

        await harness.SeedFarmMembershipAsync(farmAId, WorkerUserId, AppRole.Worker);

        using (var createLogForAssignedFarm = CreateJsonRequest(
                   HttpMethod.Post,
                   "/sync/push",
                   new
                   {
                       deviceId = "device-scope-worker",
                       mutations = new[]
                       {
                           new
                           {
                               clientRequestId = "req-log-scope-a",
                               mutationType = "create_daily_log",
                               payload = new
                               {
                                   dailyLogId = logAId,
                                   farmId = farmAId,
                                   plotId = plotAId,
                                   cropCycleId = cycleAId,
                                   logDate = "2026-03-05"
                               }
                           }
                       }
                   },
                   WorkerUserId,
                   "shramsafal:Worker"))
        {
            var assignedFarmResponse = await harness.Client.SendAsync(createLogForAssignedFarm);
            assignedFarmResponse.EnsureSuccessStatusCode();
            Assert.Equal("applied", await ReadFirstPushStatusAsync(assignedFarmResponse));
        }

        using (var createLogForOtherFarm = CreateJsonRequest(
                   HttpMethod.Post,
                   "/sync/push",
                   new
                   {
                       deviceId = "device-scope-worker",
                       mutations = new[]
                       {
                           new
                           {
                               clientRequestId = "req-log-scope-b",
                               mutationType = "create_daily_log",
                               payload = new
                               {
                                   dailyLogId = logBId,
                                   farmId = farmBId,
                                   plotId = plotBId,
                                   cropCycleId = cycleBId,
                                   logDate = "2026-03-05"
                               }
                           }
                       }
                   },
                   WorkerUserId,
                   "shramsafal:Worker"))
        {
            var otherFarmResponse = await harness.Client.SendAsync(createLogForOtherFarm);
            otherFarmResponse.EnsureSuccessStatusCode();

            using var doc = JsonDocument.Parse(await otherFarmResponse.Content.ReadAsStringAsync());
            var result = doc.RootElement.GetProperty("results")[0];
            Assert.Equal("failed", result.GetProperty("status").GetString());
            Assert.Equal("ShramSafal.Forbidden", result.GetProperty("errorCode").GetString());
        }

        using var pullForWorker = CreateRequest(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(DateTime.UnixEpoch.ToString("O"))}", WorkerUserId, "shramsafal:Worker");
        var pullResponse = await harness.Client.SendAsync(pullForWorker);
        pullResponse.EnsureSuccessStatusCode();

        using var pullDoc = JsonDocument.Parse(await pullResponse.Content.ReadAsStringAsync());
        var visibleFarmIds = pullDoc.RootElement
            .GetProperty("farms")
            .EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid())
            .ToList();

        Assert.Contains(farmAId, visibleFarmIds);
        Assert.DoesNotContain(farmBId, visibleFarmIds);
    }

    [Fact]
    public async Task FarmMembership_RoleControlsOwnerOnlyActions()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();
        var workerPlotId = Guid.NewGuid();
        var ownerPlotId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-role", "req-farm-role", farmId, "Role Farm");
        await harness.SeedFarmMembershipAsync(farmId, WorkerUserId, AppRole.Worker);
        await harness.SeedFarmMembershipAsync(farmId, SecondaryOwnerUserId, AppRole.SecondaryOwner);

        using (var workerCreatePlot = CreateJsonRequest(
                   HttpMethod.Post,
                   "/sync/push",
                   new
                   {
                       deviceId = "device-role-worker",
                       mutations = new[]
                       {
                           new
                           {
                               clientRequestId = "req-plot-role-worker",
                               mutationType = "create_plot",
                               payload = new
                               {
                                   plotId = workerPlotId,
                                   farmId,
                                   name = "Worker Plot Attempt",
                                   areaInAcres = 1m
                               }
                           }
                       }
                   },
                   WorkerUserId,
                   "shramsafal:Worker"))
        {
            var workerResponse = await harness.Client.SendAsync(workerCreatePlot);
            workerResponse.EnsureSuccessStatusCode();

            using var doc = JsonDocument.Parse(await workerResponse.Content.ReadAsStringAsync());
            var result = doc.RootElement.GetProperty("results")[0];
            Assert.Equal("failed", result.GetProperty("status").GetString());
            Assert.Equal("ShramSafal.Forbidden", result.GetProperty("errorCode").GetString());
        }

        using (var secondaryOwnerCreatePlot = CreateJsonRequest(
                   HttpMethod.Post,
                   "/sync/push",
                   new
                   {
                       deviceId = "device-role-owner",
                       mutations = new[]
                       {
                           new
                           {
                               clientRequestId = "req-plot-role-owner",
                               mutationType = "create_plot",
                               payload = new
                               {
                                   plotId = ownerPlotId,
                                   farmId,
                                   name = "Secondary Owner Plot",
                                   areaInAcres = 1.5m
                               }
                           }
                       }
                   },
                   SecondaryOwnerUserId,
                   "shramsafal:Worker"))
        {
            var ownerResponse = await harness.Client.SendAsync(secondaryOwnerCreatePlot);
            ownerResponse.EnsureSuccessStatusCode();
            Assert.Equal("applied", await ReadFirstPushStatusAsync(ownerResponse));
        }
    }

    [Fact]
    public async Task Push_TestInstanceCollected_TransitionsDueToCollected()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-ti-collect", "req-farm-ti-collect", farmId, "Test Collect Farm");
        await harness.SeedFarmMembershipAsync(farmId, TestUserId, AppRole.LabOperator);

        var instance = await harness.SeedTestInstanceAsync(
            farmId,
            plotId: Guid.NewGuid(),
            cropCycleId: Guid.NewGuid());

        using var request = CreateJsonRequest(
            HttpMethod.Post,
            "/sync/push",
            new
            {
                deviceId = "device-ti-collect",
                mutations = new[]
                {
                    new
                    {
                        clientRequestId = "req-ti-collect-1",
                        mutationType = "testinstance.collected",
                        payload = new
                        {
                            testInstanceId = instance.Id
                        }
                    }
                }
            },
            TestUserId,
            "shramsafal:LabOperator");

        var response = await harness.Client.SendAsync(request);
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var result = doc.RootElement.GetProperty("results")[0];
        Assert.Equal("applied", result.GetProperty("status").GetString());

        var data = result.GetProperty("data");
        Assert.Equal("Collected", data.GetProperty("status").GetString());
        Assert.Equal(instance.Id, data.GetProperty("testInstanceId").GetGuid());
    }

    [Fact]
    public async Task Push_TestInstanceReported_RecordsResultsAndReturnsRecommendations()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-ti-report", "req-farm-ti-report", farmId, "Test Report Farm");
        await harness.SeedFarmMembershipAsync(farmId, TestUserId, AppRole.LabOperator);

        var instance = await harness.SeedTestInstanceAsync(
            farmId,
            plotId: Guid.NewGuid(),
            cropCycleId: Guid.NewGuid());

        // Transition Due → Collected first so the Reported push can land.
        using (var collectRequest = CreateJsonRequest(
                   HttpMethod.Post,
                   "/sync/push",
                   new
                   {
                       deviceId = "device-ti-report",
                       mutations = new[]
                       {
                           new
                           {
                               clientRequestId = "req-ti-report-collect",
                               mutationType = "testinstance.collected",
                               payload = new
                               {
                                   testInstanceId = instance.Id
                               }
                           }
                       }
                   },
                   TestUserId,
                   "shramsafal:LabOperator"))
        {
            var collectResponse = await harness.Client.SendAsync(collectRequest);
            collectResponse.EnsureSuccessStatusCode();
            Assert.Equal("applied", await ReadFirstPushStatusAsync(collectResponse));
        }

        var attachmentId = Guid.NewGuid();

        using var reportRequest = CreateJsonRequest(
            HttpMethod.Post,
            "/sync/push",
            new
            {
                deviceId = "device-ti-report",
                mutations = new[]
                {
                    new
                    {
                        clientRequestId = "req-ti-report-result",
                        mutationType = "testinstance.reported",
                        payload = new
                        {
                            testInstanceId = instance.Id,
                            results = new[]
                            {
                                new
                                {
                                    parameterCode = "pH",
                                    parameterValue = "6.8",
                                    unit = "pH",
                                    referenceRangeLow = 6.0m,
                                    referenceRangeHigh = 7.5m
                                }
                            },
                            attachmentIds = new[] { attachmentId },
                            clientCommandId = (string?)null
                        }
                    }
                }
            },
            TestUserId,
            "shramsafal:LabOperator");

        var reportResponse = await harness.Client.SendAsync(reportRequest);
        reportResponse.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await reportResponse.Content.ReadAsStringAsync());
        var result = doc.RootElement.GetProperty("results")[0];
        Assert.Equal("applied", result.GetProperty("status").GetString());

        var data = result.GetProperty("data");
        Assert.Equal("Reported", data.GetProperty("status").GetString());
        Assert.True(data.TryGetProperty("recommendations", out var recs));
        Assert.Equal(JsonValueKind.Array, recs.ValueKind);
    }

    [Fact]
    public async Task Push_TestInstanceCollected_RejectsNonMembers()
    {
        await using var harness = await TestHarness.CreateAsync();
        var farmId = Guid.NewGuid();

        await PushCreateFarmAsync(harness.Client, "device-ti-forbidden", "req-farm-ti-forbidden", farmId, "Forbidden Farm");
        // NOTE: WorkerUserId is NOT added as a member of this farm.

        var instance = await harness.SeedTestInstanceAsync(
            farmId,
            plotId: Guid.NewGuid(),
            cropCycleId: Guid.NewGuid());

        using var request = CreateJsonRequest(
            HttpMethod.Post,
            "/sync/push",
            new
            {
                deviceId = "device-ti-forbidden",
                mutations = new[]
                {
                    new
                    {
                        clientRequestId = "req-ti-forbidden-1",
                        mutationType = "testinstance.collected",
                        payload = new
                        {
                            testInstanceId = instance.Id
                        }
                    }
                }
            },
            WorkerUserId,
            "shramsafal:LabOperator");

        var response = await harness.Client.SendAsync(request);
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var result = doc.RootElement.GetProperty("results")[0];
        Assert.Equal("failed", result.GetProperty("status").GetString());
        Assert.Equal("ShramSafal.Forbidden", result.GetProperty("errorCode").GetString());
    }

    /// <summary>
    /// Sub-plan 03 Task 10 (T-IGH-03-PULL-CURSOR-FREEZE) — explicit
    /// fail-injection coverage for the cursor-freeze invariant. Pulls
    /// against a harness whose IComplianceSignalRepository throws on
    /// GetSinceCursorAsync, asserts the response is 200 with the
    /// degraded component listed AND NextCursorUtc rewound to SinceUtc,
    /// then clears the failure and verifies a retry with the SAME
    /// `since=` parameter returns the missed rows.
    /// </summary>
    [Fact]
    public async Task Pull_WhenComplianceSignalsRepositoryThrows_FreezesCursor_AndSurfacesDegradedComponent_AndRetryDelivers()
    {
        var failing = new FailingComplianceSignalStub { FailOnGetSinceCursor = true };

        await using var harness = await TestHarness.CreateAsync(services =>
        {
            services.RemoveAll<IComplianceSignalRepository>();
            services.AddSingleton<IComplianceSignalRepository>(failing);
        });

        // Seed one farm so a healthy pull would normally return data.
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-freeze-1", "req-freeze-1", farmId, "Freeze Test Farm");

        var sinceLiteral = DateTime.UnixEpoch.ToString("O");
        var firstPull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(sinceLiteral)}");

        // (1) Response status 200.
        Assert.Equal(System.Net.HttpStatusCode.OK, firstPull.StatusCode);

        // (2) X-Degraded header present and contains the failed component.
        Assert.True(firstPull.Headers.Contains("X-Degraded"),
            "X-Degraded header must be present when at least one component degraded.");
        var degradedHeaderValue = string.Join(",", firstPull.Headers.GetValues("X-Degraded"));
        Assert.Contains("ComplianceSignals", degradedHeaderValue);

        // (3) Body's `degradedComponents` lists the failed component.
        using var firstDoc = JsonDocument.Parse(await firstPull.Content.ReadAsStringAsync());
        var degradedNames = firstDoc.RootElement.GetProperty("degradedComponents")
            .EnumerateArray()
            .Select(c => c.GetProperty("componentName").GetString())
            .ToList();
        Assert.Contains("ComplianceSignals", degradedNames);

        // (4) NextCursorUtc was rewound to the caller's since (frozen).
        var firstNextCursor = firstDoc.RootElement.GetProperty("nextCursorUtc").GetDateTime();
        var sinceUtc = DateTime.SpecifyKind(DateTime.UnixEpoch, DateTimeKind.Utc);
        Assert.Equal(sinceUtc, firstNextCursor.ToUniversalTime());

        // The failed pull MUST have invoked the failing method
        // (otherwise the freeze trigger isn't really exercising the
        // throw — it might have short-circuited elsewhere).
        Assert.True(failing.GetSinceCursorCallCount > 0,
            "FailingComplianceSignalStub.GetSinceCursorAsync must have been called.");

        // (5) Clear the failure and retry with the SAME since=. The missed
        //     farm row should reach the client now that the cursor stayed
        //     at SinceUtc rather than advancing past it.
        failing.FailOnGetSinceCursor = false;
        var retryPull = await harness.Client.GetAsync($"/sync/pull?since={Uri.EscapeDataString(sinceLiteral)}");
        Assert.Equal(System.Net.HttpStatusCode.OK, retryPull.StatusCode);

        // No degradation this time → no X-Degraded header, no body components.
        Assert.False(retryPull.Headers.Contains("X-Degraded"));
        using var retryDoc = JsonDocument.Parse(await retryPull.Content.ReadAsStringAsync());
        if (retryDoc.RootElement.TryGetProperty("degradedComponents", out var retryDegraded)
            && retryDegraded.ValueKind == JsonValueKind.Array)
        {
            Assert.Empty(retryDegraded.EnumerateArray());
        }

        var retryFarms = retryDoc.RootElement.GetProperty("farms")
            .EnumerateArray()
            .Select(x => x.GetProperty("id").GetGuid())
            .ToList();
        Assert.Contains(farmId, retryFarms);

        // Retry's cursor SHOULD have advanced past SinceUtc since the
        // healthy pull found data — proves the freeze was a one-pull
        // safety, not a permanent stick.
        var retryCursor = retryDoc.RootElement.GetProperty("nextCursorUtc").GetDateTime().ToUniversalTime();
        Assert.True(retryCursor > sinceUtc,
            $"Retry cursor {retryCursor:O} must advance past since {sinceUtc:O} when the failure clears.");
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

    private static HttpRequestMessage CreateJsonRequest<T>(
        HttpMethod method,
        string uri,
        T body,
        Guid userId,
        string membershipClaim)
    {
        var request = CreateRequest(method, uri, userId, membershipClaim);
        request.Content = JsonContent.Create(body);
        return request;
    }

    private static HttpRequestMessage CreateRequest(
        HttpMethod method,
        string uri,
        Guid userId,
        string membershipClaim)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Add("X-Test-UserId", userId.ToString());
        request.Headers.Add("X-Test-Membership", membershipClaim);
        return request;
    }

    private sealed class TestHarness(WebApplication app, HttpClient client, string storageDirectory) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        /// <summary>
        /// Build the test harness with optional last-mile DI overrides.
        /// The <paramref name="configureExtraServices"/> callback runs
        /// AFTER all the harness's standard registrations (BuildingBlocks,
        /// ShramSafal API, the InMemoryComplianceSignalStub, the
        /// AllowEntitlementPolicy override, the InMemory DbContext) so a
        /// test that injects a failing-by-design dependency can do so by
        /// calling <c>RemoveAll&lt;T&gt;()</c> + re-registering. Used by
        /// <c>PullSyncCursorFreezeTests</c> to wire a deliberately-throwing
        /// <c>IComplianceSignalRepository</c> per Sub-plan 03 Task 10
        /// fail-injection coverage (T-IGH-03-PULL-CURSOR-FREEZE).
        /// </summary>
        public static async Task<TestHarness> CreateAsync(Action<IServiceCollection>? configureExtraServices = null)
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
            // Analytics writer — handlers now depend on IAnalyticsWriter. Give
            // the test harness an in-memory analytics store so emits flow
            // through the real failure-isolated writer rather than a noop.
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase($"sync-tests-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            // Entitlement policy override — Slice 2 added a subscription gate to
            // every paid handler, but this integration harness doesn't stand up
            // the Accounts module (no seeded subscriptions). Swap in an
            // "always allowed" policy so sync-push tests keep asserting the
            // sync contract, not subscription plumbing.
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();

            // Sub-plan 03 Task 10 (T-IGH-03-PULL-CURSOR-FREEZE): the
            // production ComplianceSignalRepository uses LINQ patterns
            // (`MaxAsync` over a value-object filter) that throw
            // InvalidOperationException under EF InMemory but work fine
            // against real Postgres. Without this stub, every PullSync
            // call inside this harness records a spurious "ComplianceFreshness"
            // / "ComplianceSignals" DegradedComponent, which trips the
            // (now re-enabled) cursor-freeze logic and breaks
            // Pull_WithCursor_ReturnsOnlyDeltas. Stub it with an empty
            // in-memory implementation so the harness exercises the
            // sync contract without InMemory artifacts.
            //
            // NOTE: there is NO dedicated unit test that directly
            // exercises the cursor-freeze branch with a throwing stub
            // yet. That coverage is filed as the remaining work item
            // under T-IGH-03-PULL-CURSOR-FREEZE (PARTIAL_DONE).
            // What protects the freeze today: (a) this harness's
            // healthy-path tests prove the freeze does NOT false-trip
            // when nothing fails, and (b) the architecture gate
            // (Application_layer_must_not_silently_swallow_exceptions)
            // ensures any thrown sub-system error surfaces as a
            // DegradedComponent and therefore triggers the freeze.
            builder.Services.RemoveAll<IComplianceSignalRepository>();
            builder.Services.AddScoped<IComplianceSignalRepository, InMemoryComplianceSignalStub>();

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"sync-tests-{Guid.NewGuid()}";
            // T-IGH-03-OUTBOX-WIRING: attach the outbox interceptors
            // to the test DbContext too, so integration tests exercise
            // the same SaveChanges-side and TransactionRollback-side
            // outbox plumbing that production runs. The interceptor
            // services were registered as singletons by
            // AddShramSafalApi → AddShramSafalInfrastructure earlier.
            builder.Services.AddDbContext<ShramSafalDbContext>((sp, options) =>
            {
                options.UseInMemoryDatabase(dbName, dbRoot);
                var saveSide = sp.GetService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>();
                var txSide = sp.GetService<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>();
                if (saveSide is not null && txSide is not null)
                {
                    options.AddInterceptors(saveSide, txSide);
                }
            });

            // Last-mile override hook — runs after every standard
            // registration so a test can replace a specific service
            // (e.g. inject a throwing IComplianceSignalRepository to
            // exercise the cursor-freeze branch).
            configureExtraServices?.Invoke(builder.Services);

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new TestHarness(app, client, storageDirectory);
        }

        public async Task SeedFarmMembershipAsync(Guid farmId, Guid userId, AppRole role)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
            db.FarmMemberships.Add(FarmMembership.Create(
                Guid.NewGuid(),
                new FarmId(farmId),
                new UserId(userId),
                role,
                DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        /// <summary>
        /// Seeds a <see cref="TestInstance"/> in the in-memory test-stack
        /// repository (CEI Phase 2 placeholder — full EF wiring lands in Phase 3).
        /// Returns the instance so the caller can reference its Id.
        /// </summary>
        public async Task<TestInstance> SeedTestInstanceAsync(
            Guid farmId,
            Guid plotId,
            Guid cropCycleId,
            Guid? protocolId = null,
            TestProtocolKind kind = TestProtocolKind.Soil,
            string stageName = "Fruiting",
            DateOnly? plannedDueDate = null)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var repo = scope.ServiceProvider.GetRequiredService<ITestInstanceRepository>();
            var instance = TestInstance.Schedule(
                id: Guid.NewGuid(),
                testProtocolId: protocolId ?? Guid.NewGuid(),
                protocolKind: kind,
                cropCycleId: cropCycleId,
                farmId: new FarmId(farmId),
                plotId: plotId,
                stageName: stageName,
                plannedDueDate: plannedDueDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
                createdAtUtc: DateTime.UtcNow);
            await repo.AddAsync(instance);
            return instance;
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
            var userId = Request.Headers.TryGetValue("X-Test-UserId", out var userIdHeader) &&
                         Guid.TryParse(userIdHeader, out var parsedUserId)
                ? parsedUserId
                : TestUserId;
            var membership = Request.Headers.TryGetValue("X-Test-Membership", out var membershipHeader)
                ? membershipHeader.ToString()
                : "shramsafal:PrimaryOwner";

            var claims = new List<Claim>
            {
                new("sub", userId.ToString())
            };
            if (!string.IsNullOrWhiteSpace(membership))
            {
                claims.Add(new Claim("membership", membership));
            }

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    /// <summary>
    /// Integration-test stub that bypasses the Slice 2 subscription gate.
    /// The Accounts module is intentionally not spun up for sync-push tests,
    /// so there's no real subscription to evaluate. Tests that specifically
    /// need to assert gate behaviour should swap this out for the real policy.
    /// </summary>
    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId,
            FarmId farmId,
            PaidFeature feature,
            CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(
                Allowed: true,
                EntitlementReason.Allowed,
                SubscriptionStatus: null));
    }

    /// <summary>
    /// Sub-plan 03 Task 10 (T-IGH-03-PULL-CURSOR-FREEZE) test-rig stub.
    /// Returns empty / null defaults for every read; no-op for writes.
    /// Replaces the production <c>ComplianceSignalRepository</c> in the
    /// sync-tests harness because the production EF Core LINQ uses
    /// <c>MaxAsync</c> + value-object equality patterns that throw
    /// <c>InvalidOperationException</c> under the InMemory provider —
    /// causing PullSync to record spurious DegradedComponents and
    /// (with cursor-freeze enabled) freeze the cursor, which breaks
    /// every assertion downstream.
    /// </summary>
    /// <summary>
    /// Sub-plan 03 Task 10 (T-IGH-03-PULL-CURSOR-FREEZE) fail-injection stub.
    /// Behaves identically to <see cref="InMemoryComplianceSignalStub"/>
    /// EXCEPT that <see cref="GetSinceCursorAsync"/> throws when
    /// <see cref="FailOnGetSinceCursor"/> is set. The flag is mutable so a
    /// single test can run two pulls — the first with the failure injected
    /// (asserts cursor freezes), the second with the failure cleared
    /// (asserts the missed rows reach the client). Registered via
    /// <c>TestHarness.CreateAsync(configureExtraServices: ...)</c>.
    /// </summary>
    internal sealed class FailingComplianceSignalStub : IComplianceSignalRepository
    {
        public bool FailOnGetSinceCursor { get; set; } = true;
        public int GetSinceCursorCallCount { get; private set; }

        public Task<ShramSafal.Domain.Compliance.ComplianceSignal?> FindOpenAsync(
            FarmId farmId, Guid plotId, string ruleCode, Guid? cropCycleId, CancellationToken ct = default)
            => Task.FromResult<ShramSafal.Domain.Compliance.ComplianceSignal?>(null);

        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetOpenForFarmAsync(
            FarmId farmId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());

        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetForFarmAsync(
            FarmId farmId, bool includeResolved, bool includeAcknowledged, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());

        public Task<ShramSafal.Domain.Compliance.ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult<ShramSafal.Domain.Compliance.ComplianceSignal?>(null);

        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetSinceCursorAsync(
            FarmId farmId, DateTime cursor, CancellationToken ct = default)
        {
            GetSinceCursorCallCount++;
            if (FailOnGetSinceCursor)
            {
                throw new InvalidOperationException(
                    "Test-injected failure: ComplianceSignalRepository.GetSinceCursorAsync");
            }
            return Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(
                Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());
        }

        public void Add(ShramSafal.Domain.Compliance.ComplianceSignal signal) { /* no-op */ }

        public Task<DateTime?> GetLatestEvaluationTimeAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult<DateTime?>(null);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class InMemoryComplianceSignalStub : IComplianceSignalRepository
    {
        public Task<ShramSafal.Domain.Compliance.ComplianceSignal?> FindOpenAsync(
            FarmId farmId, Guid plotId, string ruleCode, Guid? cropCycleId, CancellationToken ct = default)
            => Task.FromResult<ShramSafal.Domain.Compliance.ComplianceSignal?>(null);

        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetOpenForFarmAsync(
            FarmId farmId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());

        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetForFarmAsync(
            FarmId farmId, bool includeResolved, bool includeAcknowledged, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());

        public Task<ShramSafal.Domain.Compliance.ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult<ShramSafal.Domain.Compliance.ComplianceSignal?>(null);

        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetSinceCursorAsync(
            FarmId farmId, DateTime cursor, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());

        public void Add(ShramSafal.Domain.Compliance.ComplianceSignal signal) { /* no-op */ }

        public Task<DateTime?> GetLatestEvaluationTimeAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult<DateTime?>(null);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}

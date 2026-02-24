using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
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
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

public sealed class AiEndpointsTests
{
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task VoiceParse_ReturnsStructuredJson_AndPersistsJobAttempt()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-1", "req-farm-ai-1", farmId, "AI Voice Farm");

        var response = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
        {
            farmId,
            textTranscript = "आज पाणी दिलं.",
            idempotencyKey = "voice-parse-success-1"
        });

        var responseBody = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseBody);
        using var doc = JsonDocument.Parse(responseBody);
        Assert.True(doc.RootElement.GetProperty("success").GetBoolean());
        Assert.Equal(JsonValueKind.Object, doc.RootElement.GetProperty("parsedLog").ValueKind);

        var jobId = doc.RootElement.GetProperty("jobId").GetGuid();
        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{jobId}");
        statusResponse.EnsureSuccessStatusCode();

        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Equal("Succeeded", statusDoc.RootElement.GetProperty("status").GetString());
        Assert.Single(statusDoc.RootElement.GetProperty("attempts").EnumerateArray());
        Assert.Equal(JsonValueKind.Object, statusDoc.RootElement.GetProperty("result").ValueKind);
    }

    [Fact]
    public async Task VoiceParse_AcceptsSegmentMetadata_ForJsonPayload()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-meta-1", "req-farm-ai-meta-1", farmId, "AI Metadata Farm");

        var metadataJson = JsonSerializer.Serialize(new
        {
            sessionId = "session-meta-1",
            farmId = farmId.ToString(),
            totalSegments = 1,
            totalSpeechDurationMs = 12_000,
            totalRawDurationMs = 12_000,
            totalSilenceRemovedMs = 0,
            compressionRatio = 1
        });

        var response = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
        {
            farmId,
            textTranscript = "आज पाणी दिलं.",
            idempotencyKey = "voice-parse-metadata-json-1",
            inputSpeechDurationMs = 12000,
            inputRawDurationMs = 12000,
            segmentMetadataJson = metadataJson
        });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        using var doc = JsonDocument.Parse(body);
        Assert.True(doc.RootElement.GetProperty("success").GetBoolean());
    }

    [Fact]
    public async Task VoiceParse_RejectsMalformedSegmentMetadata_WithStableErrorCode()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-meta-2", "req-farm-ai-meta-2", farmId, "AI Metadata Validation Farm");

        var malformedMetadataJson = JsonSerializer.Serialize(new
        {
            sessionId = "session-meta-bad-1",
            totalSegments = 35,
            totalSpeechDurationMs = 12_000,
            totalRawDurationMs = 12_000
        });

        var response = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
        {
            farmId,
            textTranscript = "आज खत टाकलं.",
            idempotencyKey = "voice-parse-metadata-json-bad-1",
            segmentMetadataJson = malformedMetadataJson
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ShramSafal.InvalidSegmentMetadata", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task VoiceParse_PersistsMetadataHash_AndCostUnits_ForAudit()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-meta-3", "req-farm-ai-meta-3", farmId, "AI Metadata Persist Farm");

        var metadataJson = JsonSerializer.Serialize(new
        {
            sessionId = "session-meta-persist-1",
            farmId = farmId.ToString(),
            totalSegments = 1,
            totalSpeechDurationMs = 8000,
            totalRawDurationMs = 12000,
            totalSilenceRemovedMs = 4000,
            compressionRatio = 0.6m,
            segments = new[]
            {
                new
                {
                    segmentIndex = 0,
                    mimeType = "audio/webm",
                    rawDurationMs = 12000,
                    speechDurationMs = 8000,
                    silenceRemovedMs = 4000
                }
            }
        });

        const string requestPayloadHash = "11aa22bb33cc44dd55ee66ff77aa88bb99cc00dd11ee22ff33aa44bb55cc66dd";
        var response = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
        {
            farmId,
            textTranscript = "आज फवारणी केली.",
            idempotencyKey = "voice-parse-metadata-persist-1",
            inputSpeechDurationMs = 8000,
            inputRawDurationMs = 12000,
            segmentMetadataJson = metadataJson,
            requestPayloadHash
        });

        var responseBody = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseBody);

        using var parseDoc = JsonDocument.Parse(responseBody);
        var jobId = parseDoc.RootElement.GetProperty("jobId").GetGuid();
        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{jobId}");
        statusResponse.EnsureSuccessStatusCode();

        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        var metadata = statusDoc.RootElement.GetProperty("inputSessionMetadata");
        Assert.Equal("session-meta-persist-1", metadata.GetProperty("sessionId").GetString());

        var attempts = statusDoc.RootElement.GetProperty("attempts").EnumerateArray().ToList();
        Assert.Single(attempts);
        var attempt = attempts[0];
        Assert.Equal(requestPayloadHash, attempt.GetProperty("requestPayloadHash").GetString());
        Assert.True(attempt.GetProperty("estimatedCostUnits").GetDecimal() > 0m);
    }

    [Fact]
    public async Task ReceiptExtract_ReturnsStructuredJson_AndPersistsJobAttempt()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-2", "req-farm-ai-2", farmId, "AI Receipt Farm");

        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(farmId.ToString()), "farmId");
        multipart.Add(new StringContent("receipt-extract-success-1"), "idempotencyKey");

        var image = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 });
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        multipart.Add(image, "image", "receipt.jpg");

        var response = await harness.Client.PostAsync("/shramsafal/ai/receipt-extract", multipart);
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("success").GetBoolean());
        Assert.Equal(JsonValueKind.Object, doc.RootElement.GetProperty("normalizedJson").ValueKind);
        Assert.Equal(JsonValueKind.Array, doc.RootElement.GetProperty("normalizedJson").GetProperty("lineItems").ValueKind);

        var jobId = doc.RootElement.GetProperty("jobId").GetGuid();
        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{jobId}");
        statusResponse.EnsureSuccessStatusCode();

        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Equal("Succeeded", statusDoc.RootElement.GetProperty("status").GetString());
        Assert.Single(statusDoc.RootElement.GetProperty("attempts").EnumerateArray());
    }

    [Fact]
    public async Task PattiExtract_ReturnsStructuredJson_AndPersistsJobAttempt()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-2b", "req-farm-ai-2b", farmId, "AI Patti Farm");

        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(farmId.ToString()), "farmId");
        multipart.Add(new StringContent("Grapes"), "cropName");
        multipart.Add(new StringContent("patti-extract-success-1"), "idempotencyKey");

        var image = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 });
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        multipart.Add(image, "image", "patti.jpg");

        var response = await harness.Client.PostAsync("/shramsafal/ai/patti-extract", multipart);
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("success").GetBoolean());
        Assert.Equal(JsonValueKind.Object, doc.RootElement.GetProperty("normalizedJson").ValueKind);

        var jobId = doc.RootElement.GetProperty("jobId").GetGuid();
        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{jobId}");
        statusResponse.EnsureSuccessStatusCode();

        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Equal("Succeeded", statusDoc.RootElement.GetProperty("status").GetString());
        Assert.Single(statusDoc.RootElement.GetProperty("attempts").EnumerateArray());
    }

    [Fact]
    public async Task VoiceParse_WithSameIdempotencyKey_UsesCachedResult()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-3", "req-farm-ai-3", farmId, "AI Idempotency Farm");

        var payload = new
        {
            farmId,
            textTranscript = "आज खत टाकलं.",
            idempotencyKey = "voice-idempotency-test-1"
        };

        var first = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", payload);
        var firstBody = await first.Content.ReadAsStringAsync();
        Assert.True(first.IsSuccessStatusCode, firstBody);
        using var firstDoc = JsonDocument.Parse(firstBody);
        var firstJobId = firstDoc.RootElement.GetProperty("jobId").GetGuid();

        var second = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", payload);
        var secondBody = await second.Content.ReadAsStringAsync();
        Assert.True(second.IsSuccessStatusCode, secondBody);
        using var secondDoc = JsonDocument.Parse(secondBody);
        var secondJobId = secondDoc.RootElement.GetProperty("jobId").GetGuid();

        Assert.Equal(firstJobId, secondJobId);
        Assert.Equal(1, harness.Provider.VoiceParseCallCount);

        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{firstJobId}");
        statusResponse.EnsureSuccessStatusCode();
        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Single(statusDoc.RootElement.GetProperty("attempts").EnumerateArray());
    }

    [Fact]
    public async Task ReceiptExtract_WithSameIdempotencyKey_UsesCachedResult()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-receipt-idem-1", "req-farm-ai-receipt-idem-1", farmId, "AI Receipt Idempotency Farm");

        const string idempotencyKey = "receipt-idempotency-test-1";
        var first = await PostReceiptExtractAsync(harness.Client, farmId, idempotencyKey);
        var firstBody = await first.Content.ReadAsStringAsync();
        Assert.True(first.IsSuccessStatusCode, firstBody);
        using var firstDoc = JsonDocument.Parse(firstBody);
        var firstJobId = firstDoc.RootElement.GetProperty("jobId").GetGuid();

        var second = await PostReceiptExtractAsync(harness.Client, farmId, idempotencyKey);
        var secondBody = await second.Content.ReadAsStringAsync();
        Assert.True(second.IsSuccessStatusCode, secondBody);
        using var secondDoc = JsonDocument.Parse(secondBody);
        var secondJobId = secondDoc.RootElement.GetProperty("jobId").GetGuid();

        Assert.Equal(firstJobId, secondJobId);
        Assert.Equal(1, harness.Provider.ReceiptCallCount);

        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{firstJobId}");
        statusResponse.EnsureSuccessStatusCode();
        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Single(statusDoc.RootElement.GetProperty("attempts").EnumerateArray());
    }

    [Fact]
    public async Task PattiExtract_WithSameIdempotencyKey_UsesCachedResult()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-patti-idem-1", "req-farm-ai-patti-idem-1", farmId, "AI Patti Idempotency Farm");

        const string idempotencyKey = "patti-idempotency-test-1";
        var first = await PostPattiExtractAsync(harness.Client, farmId, idempotencyKey);
        var firstBody = await first.Content.ReadAsStringAsync();
        Assert.True(first.IsSuccessStatusCode, firstBody);
        using var firstDoc = JsonDocument.Parse(firstBody);
        var firstJobId = firstDoc.RootElement.GetProperty("jobId").GetGuid();

        var second = await PostPattiExtractAsync(harness.Client, farmId, idempotencyKey);
        var secondBody = await second.Content.ReadAsStringAsync();
        Assert.True(second.IsSuccessStatusCode, secondBody);
        using var secondDoc = JsonDocument.Parse(secondBody);
        var secondJobId = secondDoc.RootElement.GetProperty("jobId").GetGuid();

        Assert.Equal(firstJobId, secondJobId);
        Assert.Equal(1, harness.Provider.PattiCallCount);

        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{firstJobId}");
        statusResponse.EnsureSuccessStatusCode();
        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Single(statusDoc.RootElement.GetProperty("attempts").EnumerateArray());
    }

    [Fact]
    public async Task VoiceParse_UsesSarvamAsDefaultProvider_WhenSarvamIsHealthy()
    {
        await using var harness = await TestHarness.CreateDualProviderAsync(
            sarvamMode: FakeAiProviderMode.Success,
            geminiMode: FakeAiProviderMode.Success);

        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-sarvam-1", "req-farm-ai-sarvam-1", farmId, "AI Sarvam Default Farm");

        var response = await PostVoiceParseAudioAsync(
            harness.Client,
            farmId,
            idempotencyKey: "voice-sarvam-default-1");

        var responseBody = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseBody);
        using var doc = JsonDocument.Parse(responseBody);
        Assert.Equal("Sarvam", doc.RootElement.GetProperty("modelUsed").GetString());

        Assert.Equal(1, harness.Providers[AiProviderType.Sarvam].VoiceParseCallCount);
        Assert.Equal(0, harness.Providers[AiProviderType.Gemini].VoiceParseCallCount);

        var jobId = doc.RootElement.GetProperty("jobId").GetGuid();
        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{jobId}");
        statusResponse.EnsureSuccessStatusCode();
        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Equal("Succeeded", statusDoc.RootElement.GetProperty("status").GetString());
        var attempts = statusDoc.RootElement.GetProperty("attempts").EnumerateArray().ToList();
        Assert.Single(attempts);
        Assert.Equal("Sarvam", attempts[0].GetProperty("provider").GetString());
    }

    [Fact]
    public async Task VoiceParse_FallsBackToGemini_WhenSarvamFails()
    {
        await using var harness = await TestHarness.CreateDualProviderAsync(
            sarvamMode: FakeAiProviderMode.FailVoice,
            geminiMode: FakeAiProviderMode.Success);

        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-sarvam-2", "req-farm-ai-sarvam-2", farmId, "AI Fallback Farm");

        var response = await PostVoiceParseAudioAsync(
            harness.Client,
            farmId,
            idempotencyKey: "voice-sarvam-fallback-1");

        var responseBody = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseBody);
        using var doc = JsonDocument.Parse(responseBody);
        Assert.Equal("Gemini:fallback", doc.RootElement.GetProperty("modelUsed").GetString());

        Assert.Equal(1, harness.Providers[AiProviderType.Sarvam].VoiceParseCallCount);
        Assert.Equal(1, harness.Providers[AiProviderType.Gemini].VoiceParseCallCount);

        var jobId = doc.RootElement.GetProperty("jobId").GetGuid();
        var statusResponse = await harness.Client.GetAsync($"/shramsafal/ai/jobs/{jobId}");
        statusResponse.EnsureSuccessStatusCode();
        using var statusDoc = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Equal("FallbackSucceeded", statusDoc.RootElement.GetProperty("status").GetString());

        var attempts = statusDoc.RootElement.GetProperty("attempts").EnumerateArray().ToList();
        Assert.Equal(2, attempts.Count);
        Assert.Equal("Sarvam", attempts[0].GetProperty("provider").GetString());
        Assert.Equal("Gemini", attempts[1].GetProperty("provider").GetString());
    }

    [Fact]
    public async Task VoiceParse_UsesConfiguredMaxRetries_ForPrimaryProvider()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.FailVoice);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-retry-1", "req-farm-ai-retry-1", farmId, "AI Retry Farm");

        var updateConfig = await harness.Client.PutAsJsonAsync("/shramsafal/ai/config", new
        {
            fallbackEnabled = false,
            maxRetries = 2
        });
        updateConfig.EnsureSuccessStatusCode();

        var response = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
        {
            farmId,
            textTranscript = "retry verification",
            idempotencyKey = "voice-retry-limit-1"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(2, harness.Provider.VoiceParseCallCount);
    }

    [Fact]
    public async Task VoiceParse_DoesNotFallback_WhenFailureClassIsUnsupportedInput()
    {
        await using var harness = await TestHarness.CreateDualProviderAsync(
            sarvamMode: FakeAiProviderMode.UnsupportedVoice,
            geminiMode: FakeAiProviderMode.Success);

        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-unsupported-1", "req-farm-ai-unsupported-1", farmId, "AI Unsupported Farm");

        var response = await PostVoiceParseAudioAsync(
            harness.Client,
            farmId,
            idempotencyKey: "voice-unsupported-no-fallback-1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(1, harness.Providers[AiProviderType.Sarvam].VoiceParseCallCount);
        Assert.Equal(0, harness.Providers[AiProviderType.Gemini].VoiceParseCallCount);

        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("Unsupported", payload.RootElement.GetProperty("message").GetString() ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task VoiceParse_CircuitBreaker_OpensAfterThresholdFailures()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.FailVoice);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-4", "req-farm-ai-4", farmId, "AI Circuit Farm");

        HttpResponseMessage? lastResponse = null;
        for (var i = 0; i < 6; i++)
        {
            lastResponse = await harness.Client.PostAsJsonAsync("/shramsafal/ai/voice-parse", new
            {
                farmId,
                textTranscript = $"failure case {i}",
                idempotencyKey = $"voice-breaker-{i}"
            });

            Assert.Equal(HttpStatusCode.BadRequest, lastResponse.StatusCode);
        }

        Assert.NotNull(lastResponse);
        Assert.Equal(5, harness.Provider.VoiceParseCallCount);

        var errorPayload = await lastResponse!.Content.ReadAsStringAsync();
        Assert.Contains("circuit", errorPayload, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Config_AdminCanUpdate_AndSettingsChangeIsAudited()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);

        var configResponse = await harness.Client.GetAsync("/shramsafal/ai/config");
        configResponse.EnsureSuccessStatusCode();
        using var configDoc = JsonDocument.Parse(await configResponse.Content.ReadAsStringAsync());
        var configId = configDoc.RootElement.GetProperty("id").GetGuid();

        var updateResponse = await harness.Client.PutAsJsonAsync("/shramsafal/ai/config", new
        {
            fallbackEnabled = true,
            maxRetries = 2,
            circuitBreakerThreshold = 4
        });
        updateResponse.EnsureSuccessStatusCode();

        using var updatedConfigDoc = JsonDocument.Parse(await updateResponse.Content.ReadAsStringAsync());
        Assert.True(updatedConfigDoc.RootElement.GetProperty("fallbackEnabled").GetBoolean());
        Assert.Equal(2, updatedConfigDoc.RootElement.GetProperty("maxRetries").GetInt32());
        Assert.Equal(4, updatedConfigDoc.RootElement.GetProperty("circuitBreakerThreshold").GetInt32());

        var auditResponse = await harness.Client.GetAsync($"/shramsafal/audit?entityType=AiProviderConfig&entityId={configId}");
        auditResponse.EnsureSuccessStatusCode();

        using var auditDoc = JsonDocument.Parse(await auditResponse.Content.ReadAsStringAsync());
        var settingsEvent = auditDoc.RootElement
            .EnumerateArray()
            .FirstOrDefault(entry => entry.GetProperty("action").GetString() == "SettingsChanged");

        Assert.True(settingsEvent.ValueKind == JsonValueKind.Object, "Expected SettingsChanged audit event.");
        Assert.Equal(TestUserId, settingsEvent.GetProperty("actorUserId").GetGuid());
    }

    [Fact]
    public async Task Health_ReturnsProviderStatus()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);

        var response = await harness.Client.GetAsync("/shramsafal/ai/health");
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ShramSafal.AI", doc.RootElement.GetProperty("module").GetString());
        var statuses = doc.RootElement.GetProperty("statuses").EnumerateArray().ToList();
        Assert.NotEmpty(statuses);
        Assert.Contains(statuses, status => status.GetProperty("provider").GetString() == "Gemini");
    }

    [Fact]
    public async Task Dashboard_ReturnsProviderStats_AndRecentFailures()
    {
        await using var harness = await TestHarness.CreateDualProviderAsync(
            sarvamMode: FakeAiProviderMode.FailVoice,
            geminiMode: FakeAiProviderMode.Success);

        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-dashboard-1", "req-farm-ai-dashboard-1", farmId, "AI Dashboard Farm");

        var response = await PostVoiceParseAudioAsync(harness.Client, farmId, idempotencyKey: "dashboard-fallback-1");
        var responseBody = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseBody);

        var dashboardResponse = await harness.Client.GetAsync("/shramsafal/ai/dashboard");
        dashboardResponse.EnsureSuccessStatusCode();
        using var dashboardDoc = JsonDocument.Parse(await dashboardResponse.Content.ReadAsStringAsync());

        var successes = dashboardDoc.RootElement.GetProperty("successes");
        var failures = dashboardDoc.RootElement.GetProperty("failures");
        var recentJobs = dashboardDoc.RootElement.GetProperty("recentJobs").EnumerateArray().ToList();

        var totalSuccesses = successes.EnumerateObject().Sum(property => property.Value.GetInt32());
        var totalFailures = failures.EnumerateObject().Sum(property => property.Value.GetInt32());

        Assert.True(totalSuccesses > 0, "Expected success stats after fallback.");
        Assert.True(totalFailures > 0, "Expected failure stats after fallback.");
        Assert.Contains(recentJobs, job => job.GetProperty("status").GetString() == "FallbackSucceeded");
    }

    [Fact]
    public async Task ReceiptExtract_RejectsUnsupportedImageMimeType()
    {
        await using var harness = await TestHarness.CreateAsync(FakeAiProviderMode.Success);
        var farmId = Guid.NewGuid();
        await PushCreateFarmAsync(harness.Client, "device-ai-5", "req-farm-ai-5", farmId, "AI Validation Farm");

        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(farmId.ToString()), "farmId");

        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("not-an-image"));
        file.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        multipart.Add(file, "image", "bad.txt");

        var response = await harness.Client.PostAsync("/shramsafal/ai/receipt-extract", multipart);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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

    private static async Task<HttpResponseMessage> PostVoiceParseAudioAsync(
        HttpClient client,
        Guid farmId,
        string idempotencyKey)
    {
        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(farmId.ToString()), "farmId");
        multipart.Add(new StringContent(idempotencyKey), "idempotencyKey");

        var audio = new ByteArrayContent(new byte[] { 0x52, 0x49, 0x46, 0x46 });
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        multipart.Add(audio, "audio", "voice.webm");

        return await client.PostAsync("/shramsafal/ai/voice-parse", multipart);
    }

    private static async Task<HttpResponseMessage> PostReceiptExtractAsync(
        HttpClient client,
        Guid farmId,
        string idempotencyKey)
    {
        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(farmId.ToString()), "farmId");
        multipart.Add(new StringContent(idempotencyKey), "idempotencyKey");

        var image = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 });
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        multipart.Add(image, "image", "receipt.jpg");

        return await client.PostAsync("/shramsafal/ai/receipt-extract", multipart);
    }

    private static async Task<HttpResponseMessage> PostPattiExtractAsync(
        HttpClient client,
        Guid farmId,
        string idempotencyKey)
    {
        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(farmId.ToString()), "farmId");
        multipart.Add(new StringContent("Grapes"), "cropName");
        multipart.Add(new StringContent(idempotencyKey), "idempotencyKey");

        var image = new ByteArrayContent(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 });
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        multipart.Add(image, "image", "patti.jpg");

        return await client.PostAsync("/shramsafal/ai/patti-extract", multipart);
    }

    private sealed class TestHarness(
        WebApplication app,
        HttpClient client,
        string storageDirectory,
        IReadOnlyDictionary<AiProviderType, FakeAiProvider> providers) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;
        public FakeAiProvider Provider => Providers.Values.First();
        public IReadOnlyDictionary<AiProviderType, FakeAiProvider> Providers { get; } = providers;

        public static async Task<TestHarness> CreateAsync(FakeAiProviderMode mode)
        {
            var provider = new FakeAiProvider(mode, AiProviderType.Gemini);
            return await CreateInternalAsync([provider]);
        }

        public static async Task<TestHarness> CreateDualProviderAsync(
            FakeAiProviderMode sarvamMode,
            FakeAiProviderMode geminiMode)
        {
            var sarvam = new FakeAiProvider(sarvamMode, AiProviderType.Sarvam);
            var gemini = new FakeAiProvider(geminiMode, AiProviderType.Gemini);
            return await CreateInternalAsync([sarvam, gemini]);
        }

        private static async Task<TestHarness> CreateInternalAsync(IReadOnlyList<FakeAiProvider> aiProviders)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-ai-tests", Guid.NewGuid().ToString("N"));
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

            builder.Services.RemoveAll<IAiProvider>();
            foreach (var aiProvider in aiProviders)
            {
                builder.Services.AddSingleton(aiProvider);
                builder.Services.AddSingleton<IAiProvider>(aiProvider);
            }

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"ai-tests-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            var providersByType = aiProviders.ToDictionary(x => x.ProviderType);
            return new TestHarness(app, client, storageDirectory, providersByType);
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

    private enum FakeAiProviderMode
    {
        Success,
        FailVoice,
        UnsupportedVoice,
        FailAll
    }

    private sealed class FakeAiProvider(FakeAiProviderMode mode, AiProviderType providerType) : IAiProvider
    {
        private int _voiceParseCallCount;
        private int _receiptCallCount;
        private int _pattiCallCount;

        public AiProviderType ProviderType { get; } = providerType;
        public int VoiceParseCallCount => _voiceParseCallCount;
        public int ReceiptCallCount => _receiptCallCount;
        public int PattiCallCount => _pattiCallCount;

        public Task<bool> HealthCheckAsync(CancellationToken ct = default) => Task.FromResult(true);

        public bool CanHandle(AiOperationType operation) => true;

        public Task<VoiceParseCanonicalResult> ParseVoiceAsync(
            Stream audioStream,
            string mimeType,
            string languageHint,
            string systemPrompt,
            CancellationToken ct = default)
        {
            Interlocked.Increment(ref _voiceParseCallCount);

            if (mode == FakeAiProviderMode.UnsupportedVoice)
            {
                return Task.FromResult(new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = "Unsupported audio mime type."
                });
            }

            if (mode is FakeAiProviderMode.FailVoice or FakeAiProviderMode.FailAll)
            {
                return Task.FromResult(new VoiceParseCanonicalResult
                {
                    Success = false,
                    Error = "simulated transient failure"
                });
            }

            return Task.FromResult(new VoiceParseCanonicalResult
            {
                Success = true,
                OverallConfidence = 0.92m,
                RawTranscript = "आज पाणी दिलं.",
                NormalizedJson = """
                                 {
                                   "summary":"काम नोंदवले गेले.",
                                   "dayOutcome":"WORK_RECORDED",
                                   "cropActivities":[],
                                   "irrigation":[],
                                   "labour":[],
                                   "inputs":[],
                                   "machinery":[],
                                   "activityExpenses":[],
                                   "observations":[],
                                   "plannedTasks":[],
                                   "disturbance":null,
                                   "missingSegments":[],
                                   "unclearSegments":[],
                                   "questionsForUser":[],
                                   "fieldConfidences":{"summary":{"score":0.92,"level":"HIGH","reason":"test"}},
                                   "confidence":0.92,
                                   "fullTranscript":"आज पाणी दिलं."
                                 }
                                 """
            });
        }

        public Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
            Stream imageStream,
            string mimeType,
            string systemPrompt,
            CancellationToken ct = default)
        {
            Interlocked.Increment(ref _receiptCallCount);

            if (mode == FakeAiProviderMode.FailAll)
            {
                return Task.FromResult(new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = "simulated transient failure"
                });
            }

            return Task.FromResult(new ReceiptExtractCanonicalResult
            {
                Success = true,
                OverallConfidence = 0.90m,
                NormalizedJson = """
                                 {
                                   "success":true,
                                   "confidence":90,
                                   "vendorName":"Test Vendor",
                                   "date":"2026-02-22",
                                   "lineItems":[
                                     {
                                       "name":"Urea",
                                       "quantity":1,
                                       "unit":"bag",
                                       "unitPrice":1000,
                                       "totalAmount":1000,
                                       "suggestedCategory":"FERTILIZER",
                                       "confidence":95
                                     }
                                   ],
                                   "subtotal":1000,
                                   "discount":0,
                                   "tax":0,
                                   "grandTotal":1000,
                                   "suggestedScope":"FARM"
                                 }
                                 """
            });
        }

        public Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
            Stream imageStream,
            string mimeType,
            string systemPrompt,
            CancellationToken ct = default)
        {
            Interlocked.Increment(ref _pattiCallCount);

            if (mode == FakeAiProviderMode.FailAll)
            {
                return Task.FromResult(new ReceiptExtractCanonicalResult
                {
                    Success = false,
                    Error = "simulated transient failure"
                });
            }

            return Task.FromResult(new ReceiptExtractCanonicalResult
            {
                Success = true,
                OverallConfidence = 0.88m,
                NormalizedJson = """
                                 {
                                   "date":"2026-02-22",
                                   "pattiNumber":"P-1001",
                                   "buyerName":"Test Trader",
                                   "items":[],
                                   "deductions":{"commission":0,"transport":0,"other":0},
                                   "grossTotal":0,
                                   "netAmount":0
                                 }
                                 """
            });
        }
    }
}

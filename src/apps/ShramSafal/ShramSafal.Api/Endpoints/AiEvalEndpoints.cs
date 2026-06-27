using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Api.Endpoints;

// agrisync-prompt-ops Phase 1
//
// Test/staging-only endpoint. Defense in depth:
//   1. Never registered when ASPNETCORE_ENVIRONMENT=Production.
//   2. Even outside Production, the route is registered ONLY when
//      ALLOW_EVAL_PARSE=true is present in the configuration tree
//      (env var, secrets file, etc.).
//
// Both negative cases must return 404 (route doesn't exist) — see
// AiEvalEndpointSecurityTests.
//
// Charter ref: AGRISYNC_PROMPT_OPS_PLUGIN_2026-05-05.md §7.2, §10 R4
public static class AiEvalEndpoints
{
    public static IEndpointRouteBuilder MapAiEvalEndpoints(
        this IEndpointRouteBuilder builder,
        IHostEnvironment env,
        IConfiguration config)
    {
        if (env.IsProduction())
        {
            return builder;
        }

        if (!string.Equals(config["ALLOW_EVAL_PARSE"], "true", StringComparison.OrdinalIgnoreCase))
        {
            return builder;
        }

        builder.MapPost("/api/ai/eval-parse", async (
            EvalParseRequest request,
            IAiOrchestrator orchestrator,
            IDomainKnowledgePipelinePort domainKnowledgePipeline,
            IConfiguration requestConfig,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Transcript))
            {
                return Results.BadRequest(new { error = "transcript is required" });
            }

            var ctx = request.Context ?? EmptyContext;

            var result = await orchestrator.ParseVoiceWithOverrideAsync(
                request.Transcript,
                ctx,
                request.PromptOverride,
                request.ScenarioId,
                ct);

            // W1.P0 measurement fix (ai-intelligence-plan-2026-06-25 Task 8) —
            // ParseVoiceWithOverrideAsync is the LEAN eval path and does NOT
            // run ApplyTranscriptIntegrityCorrections, so the domain-knowledge
            // pipeline never fired on the eval endpoint (flag ON == OFF here,
            // making the golden-delta unable to MEASURE the engine).
            //
            // Apply the SAME flag-guard as the production handler: when
            // Ai:DomainKnowledgeLayer:Enabled is true, parse the LLM's
            // NormalizedJson to a JsonObject, run the 7 normalizers (C1–C7)
            // against the request transcript, and return the corrected JSON.
            // When the flag is false (default) this block is a no-op and the
            // eval output is byte-identical to the pre-fix behaviour.
            var rawJson = string.IsNullOrWhiteSpace(result.ParsedJson) ? "{}" : result.ParsedJson;
            var domainLayerEnabled = requestConfig.GetValue<bool>("Ai:DomainKnowledgeLayer:Enabled");
            if (domainLayerEnabled)
            {
                try
                {
                    var root = JsonNode.Parse(rawJson)?.AsObject();
                    if (root is not null)
                    {
                        // Mirror the production handler: stamp fullTranscript so
                        // any normalizer that reads root["fullTranscript"] (rather
                        // than the explicit transcript arg) sees the same value.
                        root["fullTranscript"] = request.Transcript.Trim();
                        domainKnowledgePipeline.RunPipeline(root, request.Transcript);
                        rawJson = root.ToJsonString();
                    }
                }
                catch (JsonException)
                {
                    // Malformed LLM JSON: fall through with the raw string
                    // untouched (same defensive posture as the parse below).
                }
            }

            // Return parsed as a real JSON object (not a string) so callers can
            // diff field-by-field without a second JSON.parse.
            JsonElement parsedElement;
            try
            {
                using var doc = JsonDocument.Parse(rawJson);
                parsedElement = doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                parsedElement = JsonDocument.Parse("{}").RootElement.Clone();
            }

            return Results.Json(new EvalParseResponse(
                Parsed: parsedElement,
                PromptVersion: result.PromptVersion,
                ModelMs: result.ModelMs,
                Success: result.Success,
                Error: result.Error));
        })
        .AllowAnonymous();

        return builder;
    }

    private static readonly VoiceParseContext EmptyContext = new(
        AvailableCrops: new List<CropInfo>(),
        Profile: new FarmerProfileInfo(
            Motors: new List<MotorInfo>(),
            WaterResources: new List<WaterResourceInfo>(),
            Machineries: new List<MachineryInfo>(),
            LedgerDefaults: null),
        FarmContext: null,
        FocusCategory: null,
        VocabDb: null);
}

public sealed record EvalParseRequest(
    string Transcript,
    VoiceParseContext? Context,
    string? PromptOverride,
    string? ScenarioId);

public sealed record EvalParseResponse(
    JsonElement Parsed,
    string PromptVersion,
    long ModelMs,
    bool Success,
    string? Error);

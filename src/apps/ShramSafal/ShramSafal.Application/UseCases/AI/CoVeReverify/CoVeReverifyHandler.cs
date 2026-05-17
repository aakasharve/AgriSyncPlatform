// spec: data-principle-spine-2026-05-05/05.1
//
// Sub-phase 05.1.2 — backend Chain-of-Verification re-query.
//
// Background: until Phase 01 wave-0, CoVeWrapper.ts re-queried Gemini directly
// from the browser using VITE_GEMINI_API_KEY. That key was deleted; CoVe was
// gated to a no-op fail-open. This handler is the server-side replacement.
//
// Flow: caller (CoVeWrapper.ts → AgriSyncClient.coveReverify) posts the
// original transcript + the structured parse it wants verified. The handler
// builds a verification system prompt that asks the model to score how
// consistent the parse is with the transcript, calls the Gemini IAiProvider
// (text/plain transcript path), and reads the "confidence" field from the
// returned normalized JSON. That confidence becomes the VerificationScore;
// LowConfidence is derived against the existing client-side demotion
// threshold (0.7, mirroring CoVeWrapper.ts).
//
// Architecture rules:
//   - Lives in Application. Domain has no knowledge of CoVe.
//   - Calls Domain ports (IShramSafalRepository, IAiProvider, IEntitlementPolicy)
//     only. No Infrastructure types reach this file.
//   - Emits exactly one AuditEvent with entityType="AiJob" and action="CoVeReverified".

using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.CoVeReverify;

public sealed class CoVeReverifyHandler(
    IShramSafalRepository repository,
    IEnumerable<IAiProvider> aiProviders,
    IEntitlementPolicy entitlementPolicy)
{
    // Mirror of CoVeWrapper.ts's implicit demotion threshold: anything below
    // 0.7 is treated as low-confidence and the parse routes to manual review
    // via the client-side ConfidencePolicy. Keeping the threshold here keeps
    // the backend the single source of truth for verification scoring.
    private const decimal LowConfidenceThreshold = 0.7m;

    private const string CoVeSystemPromptTemplate = """
You are a verification assistant for an AgriSync farm-log parser.

You will receive:
  1. The original farmer transcript (Marathi or Hindi, sometimes English).
  2. The structured JSON the parser produced from that transcript.

Your job: judge how faithfully the parse reflects what the farmer actually said.

Reply with ONE JSON object exactly matching this shape — no commentary, no
extra fields — and nothing outside the JSON:
{
  "confidence": <number 0..1>,
  "summary": "<one short sentence in English explaining the score>"
}

Scoring rules (apply ALL):
  - 1.0  every key value (date, crop, quantities, actions, amounts) in the
         parsed JSON is supported by something the transcript actually says.
  - 0.7  most values are supported but at least one minor field is unsupported
         or imprecise (e.g. estimated quantity, paraphrased action).
  - 0.4  at least one important value (crop, action, amount) is contradicted
         by the transcript OR has been invented out of thin air.
  - 0.1  the parse and the transcript disagree on the central event.

Return ONLY the JSON. No prose before or after.
""";

    public async Task<Result<CoVeReverifyResult>> HandleAsync(
        CoVeReverifyCommand command,
        CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty || command.FarmId == Guid.Empty)
        {
            return Result.Failure<CoVeReverifyResult>(ShramSafalErrors.InvalidCommand);
        }

        if (string.IsNullOrWhiteSpace(command.Transcript))
        {
            return Result.Failure<CoVeReverifyResult>(ShramSafalErrors.MissingVoiceTranscript);
        }

        if (string.IsNullOrWhiteSpace(command.ParsedJson))
        {
            return Result.Failure<CoVeReverifyResult>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<CoVeReverifyResult>(ShramSafalErrors.FarmNotFound);
        }

        var canAccessFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.UserId, ct);
        if (!canAccessFarm)
        {
            return Result.Failure<CoVeReverifyResult>(ShramSafalErrors.Forbidden);
        }

        // Re-use the same paid-feature entitlement that gates voice parsing.
        // CoVe is a follow-up call on a voice parse so the policy decision
        // is identical (no separate PaidFeature.AiVerify enum).
        var gate = await EntitlementGate.CheckAsync<CoVeReverifyResult>(
            entitlementPolicy,
            new UserId(command.UserId),
            new FarmId(command.FarmId),
            PaidFeature.AiParse,
            ct);
        if (gate is not null)
        {
            return gate;
        }

        var gemini = aiProviders.FirstOrDefault(p => p.ProviderType == AiProviderType.Gemini);
        if (gemini is null)
        {
            // No provider wired in this deployment. The plan deliberately
            // calls Gemini explicitly (not the orchestrator) because CoVe
            // is a verification check that should be deterministic; failing
            // closed with AiParsingFailed surfaces the misconfiguration
            // without falling back to a different model.
            return Result.Failure<CoVeReverifyResult>(ShramSafalErrors.AiParsingFailed);
        }

        var verificationInput = BuildVerificationUserText(command.Transcript.Trim(), command.ParsedJson);
        await using var transcriptStream = new MemoryStream(
            System.Text.Encoding.UTF8.GetBytes(verificationInput),
            writable: false);

        VoiceParseCanonicalResult providerResult;
        try
        {
            providerResult = await gemini.ParseVoiceAsync(
                transcriptStream,
                mimeType: "text/plain",
                languageHint: "mr-IN",
                systemPrompt: CoVeSystemPromptTemplate,
                ct: ct);
        }
        catch (Exception ex)
        {
            return Result.Failure<CoVeReverifyResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    $"{ShramSafalErrors.AiParsingFailed.Description} {ex.Message}"));
        }

        if (!providerResult.Success)
        {
            return Result.Failure<CoVeReverifyResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    providerResult.Error ?? ShramSafalErrors.AiParsingFailed.Description));
        }

        var score = ExtractScore(providerResult);
        var lowConfidence = score < LowConfidenceThreshold;
        var demotionReason = lowConfidence
            ? $"score {score:0.00} < threshold {LowConfidenceThreshold:0.00}"
            : null;

        var result = new CoVeReverifyResult(score, lowConfidence, demotionReason);

        // Audit: one row per CoVe call. entityType "AiJob" + sourceAiJobId
        // wires the verification into the source parse's lineage so the
        // export bundle (Phase 08) can join the two. When the caller does
        // not have the source job id we stamp the row against a synthesized
        // verification id so the AuditEvent invariants (entity_id required)
        // still hold.
        var auditEntityId = command.SourceAiJobId ?? Guid.NewGuid();
        var auditEvent = AuditEventFactory.Create(
            entityType: "AiJob",
            entityId: auditEntityId,
            action: "CoVeReverified",
            actorUserId: command.UserId,
            actorRole: string.IsNullOrWhiteSpace(command.ActorRole) ? "Unknown" : command.ActorRole.Trim(),
            payload: new
            {
                verificationScore = score,
                lowConfidence,
                demotionReason,
                sourceAiJobId = command.SourceAiJobId,
                transcriptLength = command.Transcript.Length,
                modelUsed = providerResult.ModelUsed,
            },
            farmId: command.FarmId,
            clientCommandId: null,
            appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                : command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: command.SourceAiJobId);

        await repository.AddAuditEventAsync(auditEvent, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(result);
    }

    private static string BuildVerificationUserText(string transcript, string parsedJson)
    {
        // Compact the parsed JSON to a single line so it doesn't blow up
        // token usage. If it isn't valid JSON we pass it through verbatim;
        // the model still has to do its best, and a malformed parse should
        // already have flunked CoVe.
        var compactParsed = parsedJson;
        try
        {
            using var doc = JsonDocument.Parse(parsedJson);
            compactParsed = JsonSerializer.Serialize(doc.RootElement);
        }
        catch (JsonException)
        {
            // Use raw input as-is.
        }

        return $"TRANSCRIPT:\n{transcript}\n\nPARSED_JSON:\n{compactParsed}";
    }

    private static decimal ExtractScore(VoiceParseCanonicalResult providerResult)
    {
        // Preferred path: the model returned a confidence the normalizer
        // preserved on OverallConfidence. The Gemini adapter clamps to
        // [0,1] before returning so the value is already safe.
        if (providerResult.OverallConfidence > 0m)
        {
            return Math.Clamp(providerResult.OverallConfidence, 0m, 1m);
        }

        // Fallback: pull confidence out of the normalized JSON if present.
        if (!string.IsNullOrWhiteSpace(providerResult.NormalizedJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(providerResult.NormalizedJson!);
                if (doc.RootElement.TryGetProperty("confidence", out var conf))
                {
                    if (conf.ValueKind == JsonValueKind.Number && conf.TryGetDecimal(out var num))
                    {
                        if (num > 1m) num /= 100m;
                        return Math.Clamp(num, 0m, 1m);
                    }
                }
            }
            catch (JsonException)
            {
                // Fall through to the conservative default.
            }
        }

        // The model gave us nothing usable. Fail closed at 0 so the
        // lowConfidence flag flips on and the parse routes to manual
        // review — which is exactly what CoVe is supposed to do when
        // verification is inconclusive.
        return 0m;
    }
}

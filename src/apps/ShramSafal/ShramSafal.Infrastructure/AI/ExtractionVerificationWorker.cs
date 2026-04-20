using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// Background worker that picks up low-confidence draft sessions and runs
/// Sarvam Doc Intelligence + Chat to produce a verified extraction result.
/// Runs every 30 seconds, processes up to 5 sessions per cycle.
/// </summary>
internal sealed class ExtractionVerificationWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<ExtractionVerificationWorker> logger) : BackgroundService
{
    private const int BatchSize = 5;
    private const decimal MaxDraftConfidenceThreshold = 0.85m;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);

    // Minimum confidence required to consider a verified extraction trustworthy.
    private const decimal MinVerifiedConfidence = 0.70m;

    // If draft and verified totals diverge by more than this fraction, flag for review.
    private const decimal TotalDivergenceThreshold = 0.25m;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ExtractionVerificationWorker started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessPendingSessionsAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "ExtractionVerificationWorker encountered an unhandled exception during cycle.");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }

        logger.LogInformation("ExtractionVerificationWorker stopped.");
    }

    private async Task ProcessPendingSessionsAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();

        var sessionRepo = scope.ServiceProvider.GetRequiredService<IDocumentExtractionSessionRepository>();
        var storageService = scope.ServiceProvider.GetRequiredService<IAttachmentStorageService>();
        var docIntelClient = scope.ServiceProvider.GetRequiredService<SarvamDocIntelClient>();
        var chatClient = scope.ServiceProvider.GetRequiredService<SarvamChatClient>();

        var sessions = await sessionRepo.GetPendingVerificationAsync(
            BatchSize, MaxDraftConfidenceThreshold, ct);

        if (sessions.Count == 0)
        {
            return;
        }

        logger.LogInformation(
            "ExtractionVerificationWorker: processing {Count} pending session(s).",
            sessions.Count);

        foreach (var session in sessions)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            await VerifySessionAsync(session, sessionRepo, storageService, docIntelClient, chatClient, ct);
        }
    }

    private async Task VerifySessionAsync(
        DocumentExtractionSession session,
        IDocumentExtractionSessionRepository sessionRepo,
        IAttachmentStorageService storageService,
        SarvamDocIntelClient docIntelClient,
        SarvamChatClient chatClient,
        CancellationToken ct)
    {
        logger.LogDebug(
            "Verifying session {SessionId} (type={DocumentType}, draftConfidence={DraftConfidence:0.000}).",
            session.Id, session.DocumentType, session.DraftConfidence);

        try
        {
            session.StartVerification();
            await sessionRepo.SaveAsync(session, ct);

            // Load the stored image
            if (string.IsNullOrWhiteSpace(session.InputImagePath))
            {
                logger.LogWarning("Session {SessionId} has no InputImagePath; skipping verification.", session.Id);
                session.MarkNeedsReview("No stored image path for verification.");
                await sessionRepo.SaveAsync(session, ct);
                return;
            }

            var imageStream = await storageService.OpenReadAsync(session.InputImagePath, ct);
            if (imageStream is null)
            {
                logger.LogWarning("Session {SessionId}: image not found at '{Path}'.", session.Id, session.InputImagePath);
                session.MarkNeedsReview("Stored image not found.");
                await sessionRepo.SaveAsync(session, ct);
                return;
            }

            await using var _ = imageStream;
            var mimeType = session.InputMimeType ?? "image/jpeg";

            // Step 1: Run Doc Intelligence OCR to get markdown
            var docIntelResult = await docIntelClient.ProcessAsync(imageStream, mimeType, ct);
            if (!docIntelResult.IsSuccess || string.IsNullOrWhiteSpace(docIntelResult.ExtractedMarkdown))
            {
                logger.LogWarning(
                    "Session {SessionId}: Doc Intelligence failed — {Error}.",
                    session.Id, docIntelResult.Error);
                session.MarkNeedsReview($"Doc Intelligence failed: {docIntelResult.Error}");
                await sessionRepo.SaveAsync(session, ct);
                return;
            }

            // Step 2: Use Chat model to structure the OCR markdown into JSON
            var (systemPrompt, extractionLabel) = BuildChatPrompt(session.DocumentType);
            var chatResult = await chatClient.CompleteAsync(
                systemPrompt,
                $"OCR text from the {extractionLabel}:\n\n{docIntelResult.ExtractedMarkdown}",
                ct);

            if (!chatResult.IsSuccess || string.IsNullOrWhiteSpace(chatResult.Content))
            {
                logger.LogWarning(
                    "Session {SessionId}: Chat structuring failed — {Error}.",
                    session.Id, chatResult.Error);
                session.MarkNeedsReview($"Chat structuring failed: {chatResult.Error}");
                await sessionRepo.SaveAsync(session, ct);
                return;
            }

            // Step 3: Parse result and derive confidence
            var (verifiedJson, verifiedConfidence) = NormalizeAndScore(chatResult.Content);
            var verificationJobId = Guid.NewGuid(); // internal job reference

            // Step 4: Compare draft vs verified to decide outcome
            if (verifiedConfidence < MinVerifiedConfidence)
            {
                logger.LogInformation(
                    "Session {SessionId}: verified confidence {Conf:0.000} below minimum; marking NeedsReview.",
                    session.Id, verifiedConfidence);
                session.MarkNeedsReview($"Verified confidence too low: {verifiedConfidence:0.000}.");
                await sessionRepo.SaveAsync(session, ct);
                return;
            }

            var diverges = ResultsDivergeSignificantly(session.DraftResultJson, verifiedJson);
            if (diverges)
            {
                logger.LogInformation(
                    "Session {SessionId}: draft and verified results diverge; marking NeedsReview.",
                    session.Id);
                session.SetVerifiedResult(verifiedJson, verifiedConfidence, "sarvam-doc-intel+chat", verificationJobId);
                session.MarkNeedsReview("Draft and verified results differ significantly.");
                await sessionRepo.SaveAsync(session, ct);
                return;
            }

            session.SetVerifiedResult(verifiedJson, verifiedConfidence, "sarvam-doc-intel+chat", verificationJobId);
            await sessionRepo.SaveAsync(session, ct);

            logger.LogInformation(
                "Session {SessionId}: verification complete (confidence={Conf:0.000}).",
                session.Id, verifiedConfidence);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Session {SessionId}: unhandled error during verification.", session.Id);

            try
            {
                session.MarkNeedsReview($"Verification error: {ex.Message}");
                await sessionRepo.SaveAsync(session, ct);
            }
            catch (Exception saveEx)
            {
                logger.LogWarning(saveEx, "Session {SessionId}: failed to save NeedsReview status.", session.Id);
            }
        }
    }

    private static (string SystemPrompt, string Label) BuildChatPrompt(DocumentType documentType)
    {
        return documentType switch
        {
            DocumentType.Receipt => (
                """
                You are an agricultural receipt parser. Given OCR text from a purchase receipt, extract all line items.
                Return ONLY a JSON object with this exact shape:
                {
                  "items": [
                    { "name": "item name", "quantity": 1.0, "unit": "kg", "unitPrice": 100.0, "totalPrice": 100.0 }
                  ],
                  "vendorName": "shop name or null",
                  "receiptDate": "YYYY-MM-DD or null",
                  "totalAmount": 100.0,
                  "currency": "INR",
                  "confidence": 0.85
                }
                Use null for any field you cannot determine. Set confidence between 0.0 and 1.0.
                """,
                "receipt"),
            DocumentType.Patti => (
                """
                You are an agricultural patti (sale slip) parser. Given OCR text from a patti document, extract the sale details.
                Return ONLY a JSON object with this exact shape:
                {
                  "cropName": "crop name",
                  "quantity": 1.0,
                  "unit": "kg",
                  "pricePerUnit": 10.0,
                  "totalAmount": 100.0,
                  "buyerName": "buyer or null",
                  "saleDate": "YYYY-MM-DD or null",
                  "marketName": "market or null",
                  "currency": "INR",
                  "confidence": 0.85
                }
                Use null for any field you cannot determine. Set confidence between 0.0 and 1.0.
                """,
                "patti"),
            _ => (
                """
                You are a document parser. Given OCR text, extract key financial information.
                Return ONLY a JSON object with fields: totalAmount, currency, date, items (array), confidence (0.0–1.0).
                """,
                "document")
        };
    }

    /// <summary>
    /// Ensures the JSON is valid, extracts inline confidence if present, and returns both.
    /// If JSON is invalid, wraps the raw text.
    /// </summary>
    private static (string Json, decimal Confidence) NormalizeAndScore(string rawContent)
    {
        var stripped = rawContent.Trim();

        // Strip markdown code fences if present
        if (stripped.StartsWith("```json", StringComparison.OrdinalIgnoreCase))
        {
            stripped = stripped[7..];
        }
        else if (stripped.StartsWith("```"))
        {
            stripped = stripped[3..];
        }

        if (stripped.EndsWith("```"))
        {
            stripped = stripped[..^3];
        }

        stripped = stripped.Trim();

        try
        {
            using var doc = JsonDocument.Parse(stripped);
            var root = doc.RootElement;

            // Extract inline confidence if the model provided it
            decimal confidence = 0.80m;
            if (root.TryGetProperty("confidence", out var confNode) &&
                confNode.ValueKind == JsonValueKind.Number &&
                confNode.TryGetDecimal(out var inlineConf))
            {
                confidence = Math.Clamp(inlineConf, 0m, 1m);
            }

            // Return the valid JSON as-is
            return (stripped, confidence);
        }
        catch (JsonException)
        {
            // Wrap unparseable content in a fallback JSON
            var fallback = JsonSerializer.Serialize(new { rawText = stripped, confidence = 0.40m });
            return (fallback, 0.40m);
        }
    }

    /// <summary>
    /// Compares draft and verified JSON results. Returns true if they diverge significantly
    /// (different total amounts by more than <see cref="TotalDivergenceThreshold"/>).
    /// </summary>
    private static bool ResultsDivergeSignificantly(string? draftJson, string verifiedJson)
    {
        if (string.IsNullOrWhiteSpace(draftJson))
        {
            return false;
        }

        try
        {
            var draftTotal = TryReadTotal(draftJson);
            var verifiedTotal = TryReadTotal(verifiedJson);

            if (draftTotal is null || verifiedTotal is null)
            {
                return false; // Cannot compare — don't flag
            }

            if (draftTotal.Value == 0 && verifiedTotal.Value == 0)
            {
                return false;
            }

            var larger = Math.Max(Math.Abs(draftTotal.Value), Math.Abs(verifiedTotal.Value));
            var delta = Math.Abs(draftTotal.Value - verifiedTotal.Value);
            return larger > 0 && (delta / larger) > TotalDivergenceThreshold;
        }
        catch
        {
            return false;
        }
    }

    private static decimal? TryReadTotal(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            foreach (var candidateKey in new[] { "totalAmount", "total_amount", "total" })
            {
                if (root.TryGetProperty(candidateKey, out var node) &&
                    node.ValueKind == JsonValueKind.Number &&
                    node.TryGetDecimal(out var value))
                {
                    return value;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }
}

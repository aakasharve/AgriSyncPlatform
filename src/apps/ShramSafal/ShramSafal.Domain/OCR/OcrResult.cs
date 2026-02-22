using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.OCR;

public sealed class OcrResult : Entity<Guid>
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private OcrResult() : base(Guid.Empty) { } // EF Core

    private OcrResult(
        Guid id,
        Guid attachmentId,
        string rawText,
        string extractedFieldsJson,
        decimal overallConfidence,
        string modelUsed,
        int latencyMs,
        DateTime createdAtUtc)
        : base(id)
    {
        AttachmentId = attachmentId;
        RawText = rawText;
        ExtractedFieldsJson = extractedFieldsJson;
        OverallConfidence = NormalizeConfidence(overallConfidence);
        ModelUsed = modelUsed;
        LatencyMs = latencyMs;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid AttachmentId { get; private set; }
    public string RawText { get; private set; } = string.Empty;
    public string ExtractedFieldsJson { get; private set; } = "[]";
    public decimal OverallConfidence { get; private set; }
    public string ModelUsed { get; private set; } = string.Empty;
    public int LatencyMs { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static OcrResult Create(
        Guid id,
        Guid attachmentId,
        string rawText,
        IReadOnlyCollection<ExtractedField> fields,
        decimal overallConfidence,
        string modelUsed,
        int latencyMs,
        DateTime createdAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("OCR result id is required.", nameof(id));
        }

        if (attachmentId == Guid.Empty)
        {
            throw new ArgumentException("Attachment id is required.", nameof(attachmentId));
        }

        if (latencyMs < 0)
        {
            throw new ArgumentException("Latency cannot be negative.", nameof(latencyMs));
        }

        var normalizedRawText = rawText?.Trim() ?? string.Empty;
        var normalizedModel = string.IsNullOrWhiteSpace(modelUsed) ? "unknown" : modelUsed.Trim();
        var normalizedFields = fields?.ToArray() ?? [];
        var serializedFields = JsonSerializer.Serialize(normalizedFields, SerializerOptions);

        return new OcrResult(
            id,
            attachmentId,
            normalizedRawText,
            serializedFields,
            overallConfidence,
            normalizedModel,
            latencyMs,
            createdAtUtc);
    }

    public IReadOnlyList<ExtractedField> GetFields()
    {
        if (string.IsNullOrWhiteSpace(ExtractedFieldsJson))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<ExtractedField>>(ExtractedFieldsJson, SerializerOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public OcrExtractionResult ToExtractionResult()
    {
        return new OcrExtractionResult
        {
            AttachmentId = AttachmentId,
            RawText = RawText,
            Fields = GetFields(),
            OverallConfidence = OverallConfidence,
            ModelUsed = ModelUsed,
            LatencyMs = LatencyMs,
            ExtractedAtUtc = CreatedAtUtc
        };
    }

    private static decimal NormalizeConfidence(decimal confidence)
    {
        if (confidence < 0m)
        {
            return 0m;
        }

        if (confidence > 1m)
        {
            return 1m;
        }

        return decimal.Round(confidence, 4, MidpointRounding.AwayFromZero);
    }
}

// spec: correctionevent-server-persistence
namespace ShramSafal.Domain.Corrections;

public enum CorrectionTrigger
{
    EditUI,
    LowConfidenceReview,
    ManualFlag
}

public sealed class CorrectionEvent
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid OriginalParseId { get; private set; }
    public string OriginalParseRaw { get; private set; } = string.Empty;  // JSON
    public string CorrectedParse { get; private set; } = string.Empty;    // JSON
    public string PromptVersion { get; private set; } = string.Empty;
    public string Locale { get; private set; } = string.Empty;
    public CorrectionTrigger Trigger { get; private set; }
    public DateTimeOffset CapturedAtUtc { get; private set; }

    private CorrectionEvent() { }

    public static CorrectionEvent Record(
        Guid userId,
        Guid originalParseId,
        string originalParseRaw,
        string correctedParse,
        string promptVersion,
        string locale,
        CorrectionTrigger trigger)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(originalParseRaw);
        ArgumentException.ThrowIfNullOrWhiteSpace(correctedParse);
        ArgumentException.ThrowIfNullOrWhiteSpace(promptVersion);

        return new CorrectionEvent
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            OriginalParseId = originalParseId,
            OriginalParseRaw = originalParseRaw,
            CorrectedParse = correctedParse,
            PromptVersion = promptVersion,
            Locale = string.IsNullOrWhiteSpace(locale) ? "mr-IN" : locale,
            Trigger = trigger,
            CapturedAtUtc = DateTimeOffset.UtcNow
        };
    }
}

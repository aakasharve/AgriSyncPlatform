using System.Security.Cryptography;
using System.Text;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Parse-invariant identity for a derived farm operation (ADR 0023 §2).
/// <c>DerivedEventKey = SHA-256(voiceLogId ‖ rawTranscriptSpan ‖ eventType)</c>.
/// The RAW transcript span is the input — never the normalized / English /
/// redacted variant — so the key is invariant under re-parse, re-prompt,
/// rounding, or vocabulary mapping. Offline reconciliation is
/// supersede-or-no-op, never insert.
/// </summary>
public readonly record struct DerivedEventKey(string Value)
{
    public static DerivedEventKey Compute(Guid voiceLogId, string rawTranscriptSpan, string eventType)
    {
        if (string.IsNullOrWhiteSpace(rawTranscriptSpan))
            throw new ArgumentException("rawTranscriptSpan must be non-blank.", nameof(rawTranscriptSpan));
        if (string.IsNullOrWhiteSpace(eventType))
            throw new ArgumentException("eventType must be non-blank.", nameof(eventType));

        // Length-prefix the variable-length span so its boundary is unambiguous
        // regardless of content (voiceLogId:N is a fixed 32-char hex; eventType
        // is the trailing controlled token). Pipe joins the three fields.
        var material = $"{voiceLogId:N}|{rawTranscriptSpan.Length}:{rawTranscriptSpan}|{eventType}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return new DerivedEventKey(Convert.ToHexStringLower(hash));
    }

    public override string ToString() => Value;
}

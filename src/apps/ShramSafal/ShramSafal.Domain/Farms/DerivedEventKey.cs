using System.Security.Cryptography;
using System.Text;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Parse-invariant identity for a derived farm operation (ADR 0023 §2).
/// <c>DerivedEventKey = SHA-256(voiceLogId ‖ plotScope ‖ rawTranscriptSpan ‖ eventType)</c>.
/// The RAW transcript span is the input — never the normalized / English /
/// redacted variant — so the key is invariant under re-parse, re-prompt,
/// rounding, or vocabulary mapping. Offline reconciliation is
/// supersede-or-no-op, never insert.
///
/// <para><b>plotScope (multi-plot fix).</b> The mobile flow creates one DailyLog
/// PER selected plot while reusing the SAME SourceAiJobId, so every plot's
/// derivation shares the same (voiceLogId, span, eventType). The current-version
/// unique index is (farm_id, derived_event_key); without a per-plot component
/// the 2nd plot's operation would SUPERSEDE the 1st plot's (only the last plot
/// keeps a current operation — silent data loss). Folding the plot scope into
/// the identity makes per-plot operations distinct so they no longer supersede
/// one another. The scope is the plot id (stable across re-confirms of the same
/// plot), so intended supersession WITHIN one (plot, source job, event) — an
/// offline re-confirm of the same plot — still recomputes the SAME key and
/// supersedes. A null plot scope (plot-less operation) folds in as the empty
/// string, preserving a stable key for that degenerate case.</para>
/// </summary>
public readonly record struct DerivedEventKey(string Value)
{
    public static DerivedEventKey Compute(Guid voiceLogId, Guid? plotScope, string rawTranscriptSpan, string eventType)
    {
        if (string.IsNullOrWhiteSpace(rawTranscriptSpan))
            throw new ArgumentException("rawTranscriptSpan must be non-blank.", nameof(rawTranscriptSpan));
        if (string.IsNullOrWhiteSpace(eventType))
            throw new ArgumentException("eventType must be non-blank.", nameof(eventType));

        // Length-prefix the variable-length span so its boundary is unambiguous
        // regardless of content (voiceLogId:N and plotScope:N are fixed 32-char
        // hex — empty for a null plot; eventType is the trailing controlled
        // token). Pipe joins the four fields.
        var plot = plotScope is { } p ? p.ToString("N") : string.Empty;
        var material = $"{voiceLogId:N}|{plot}|{rawTranscriptSpan.Length}:{rawTranscriptSpan}|{eventType}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return new DerivedEventKey(Convert.ToHexStringLower(hash));
    }

    public override string ToString() => Value;
}

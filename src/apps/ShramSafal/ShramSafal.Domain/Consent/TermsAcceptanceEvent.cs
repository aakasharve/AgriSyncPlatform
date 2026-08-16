using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Consent;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — <c>ssf.terms_acceptance_events</c>.
///
/// <para>One row per acceptance of the Terms of Use. This is the CONTRACTUAL half of the
/// gate's single tap; <see cref="ConsentGrantEvent"/> is the data-protection half. They
/// are deliberately not one row: withdrawing consent does not un-accept the Terms, and a
/// single bundled row could not express that.</para>
///
/// <para><b>Append-only by privilege</b> — the migration issues
/// <c>REVOKE UPDATE, DELETE ON ssf.terms_acceptance_events FROM agrisync_app</c>, exactly
/// as <c>ssf.question_events</c> already does. Not a convention, not a code review rule:
/// the app role physically cannot rewrite history. A later state change is a new row.</para>
/// </summary>
public sealed class TermsAcceptanceEvent : Entity<Guid>
{
    /// <summary>The event type this table records. Written to the row so it is
    /// self-describing to anyone holding only the data.</summary>
    public const string TermsAcceptedEventType = "TERMS_ACCEPTED";

    private TermsAcceptanceEvent() : base(Guid.Empty) { } // EF Core

    private TermsAcceptanceEvent(Guid id, ConsentLedgerFacts facts, ConsentRecordStatus status, DateTime recordedAtUtc)
        : base(id)
    {
        facts.EnsureComplete();

        EventType = TermsAcceptedEventType;
        UserId = facts.UserId;
        PreRegistrationSessionId = facts.PreRegistrationSessionId;
        NoticeVersion = facts.NoticeVersion;
        PrivacyPolicyVersion = facts.PrivacyPolicyVersion;
        TermsVersion = facts.TermsVersion;
        DisplayedLanguage = facts.DisplayedLanguage;
        AcceptedPurposeCodes = facts.AcceptedPurposeCodes;
        DataCategoryCodes = facts.DataCategoryCodes;
        Source = facts.Source;
        AppVersion = facts.AppVersion;
        NoticeHash = facts.NoticeHash;
        Status = status;
        RecordedAtUtc = recordedAtUtc;
    }

    public string EventType { get; private set; } = null!;
    public Guid? UserId { get; private set; }
    public string PreRegistrationSessionId { get; private set; } = null!;
    public string NoticeVersion { get; private set; } = null!;
    public string PrivacyPolicyVersion { get; private set; } = null!;
    public string TermsVersion { get; private set; } = null!;
    public string DisplayedLanguage { get; private set; } = null!;
    public string AcceptedPurposeCodes { get; private set; } = null!;
    public string DataCategoryCodes { get; private set; } = null!;
    public ConsentRecordSource Source { get; private set; }
    public string AppVersion { get; private set; } = null!;
    public string NoticeHash { get; private set; } = null!;
    public ConsentRecordStatus Status { get; private set; }
    /// <summary>Server UTC. Never the device clock — see <see cref="ConsentLedgerFacts"/>.</summary>
    public DateTime RecordedAtUtc { get; private set; }

    public static TermsAcceptanceEvent Accept(Guid id, ConsentLedgerFacts facts, DateTime recordedAtUtc)
        => new(id, facts, ConsentRecordStatus.Granted, recordedAtUtc);

    /// <summary>A later state change — a NEW row, because the granting row is immutable.</summary>
    public static TermsAcceptanceEvent Record(
        Guid id, ConsentLedgerFacts facts, ConsentRecordStatus status, DateTime recordedAtUtc)
        => new(id, facts, status, recordedAtUtc);
}

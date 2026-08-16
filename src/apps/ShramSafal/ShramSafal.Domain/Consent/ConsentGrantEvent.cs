using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Consent;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — <c>ssf.consent_grant_events</c>.
///
/// <para>One row per DPDP consent decision. This is the DATA-PROTECTION half of the
/// gate's single tap; <see cref="TermsAcceptanceEvent"/> is the contractual half.</para>
///
/// <para><b>Purpose-limited by construction.</b> The row names the exact purpose codes
/// and data categories it grants. A purpose absent from
/// <see cref="ConsentLedgerFacts.AcceptedPurposeCodes"/> is not consented to, whatever a
/// later product decision would find convenient — which is the entire point of storing
/// codes rather than a boolean.</para>
///
/// <para><b>Withdrawable as easily as granted.</b> Because the table is append-only by
/// privilege (<c>REVOKE UPDATE, DELETE</c>), a withdrawal is a new row with
/// <see cref="ConsentRecordStatus.Withdrawn"/> naming the same purposes. The grant is not
/// erased — "granted on the 3rd, withdrawn on the 9th" is the truthful shape, and an
/// UPDATE-in-place would destroy the first half of it.</para>
/// </summary>
public sealed class ConsentGrantEvent : Entity<Guid>
{
    /// <summary>The event type written by the first-open gate.</summary>
    public const string CoreConsentGrantedEventType = "CORE_DPDP_CONSENT_GRANTED";

    private ConsentGrantEvent() : base(Guid.Empty) { } // EF Core

    private ConsentGrantEvent(
        Guid id, string eventType, ConsentLedgerFacts facts, ConsentRecordStatus status, DateTime recordedAtUtc)
        : base(id)
    {
        facts.EnsureComplete();
        if (string.IsNullOrWhiteSpace(eventType))
            throw new ArgumentException("eventType is required.", nameof(eventType));

        EventType = eventType.Trim();
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
    /// <summary>Server UTC. Never the device clock.</summary>
    public DateTime RecordedAtUtc { get; private set; }

    public static ConsentGrantEvent GrantCore(Guid id, ConsentLedgerFacts facts, DateTime recordedAtUtc)
        => new(id, CoreConsentGrantedEventType, facts, ConsentRecordStatus.Granted, recordedAtUtc);

    /// <summary>Any later decision on any purpose — a NEW row, never an edit.</summary>
    public static ConsentGrantEvent Record(
        Guid id, string eventType, ConsentLedgerFacts facts, ConsentRecordStatus status, DateTime recordedAtUtc)
        => new(id, eventType, facts, status, recordedAtUtc);
}

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

    /// <summary>
    /// The row written at registration that attaches a pre-registration acceptance to the
    /// account that resulted from it. See <see cref="LinkToUser"/> for why this exists.
    /// </summary>
    public const string TermsAcceptanceLinkedEventType = "TERMS_ACCEPTANCE_LINKED";

    private TermsAcceptanceEvent(
        Guid id, string eventType, ConsentLedgerFacts facts, ConsentRecordStatus status, DateTime recordedAtUtc)
        : base(id)
    {
        facts.EnsureComplete();

        EventType = eventType;
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
        => new(id, TermsAcceptedEventType, facts, ConsentRecordStatus.Granted, recordedAtUtc);

    /// <summary>A later state change — a NEW row, because the granting row is immutable.</summary>
    public static TermsAcceptanceEvent Record(
        Guid id, ConsentLedgerFacts facts, ConsentRecordStatus status, DateTime recordedAtUtc)
        => new(id, TermsAcceptedEventType, facts, status, recordedAtUtc);

    /// <summary>
    /// Attaches a pre-registration acceptance to the account it produced, as a NEW row.
    /// </summary>
    /// <remarks>
    /// <para><b>The defect this closes.</b> The consent gate runs BEFORE login, so the accepting
    /// row is written with <c>user_id NULL</c>. The RLS policy on this table reads
    /// <c>USING (user_id IS NOT NULL AND user_id = &lt;GUC&gt;)</c>, so that row is invisible to
    /// every user, and <c>UPDATE</c> is revoked so it can never be attached to one. Measured on
    /// 2026-08-26: consent was recorded and then silently orphaned — unproducible on a DPDP
    /// access request, with no error raised anywhere.</para>
    ///
    /// <para><b>Why a new row and not a fix to the old one.</b> Append-only is not an
    /// inconvenience here, it is the property that makes this a legal record: nobody can
    /// retro-edit what a farmer agreed to. So the linkage is recorded the same way every other
    /// state change is — as its own event, with its own timestamp.</para>
    ///
    /// <para><b>Why this row carries the full facts rather than pointing at the original.</b>
    /// The orphaned row cannot be read back by ANY role — <c>agrisync_admin</c> holds neither
    /// <c>rolsuper</c> nor <c>rolbypassrls</c>, and the table is FORCE ROW LEVEL SECURITY, so a
    /// pointer would reference something nothing can dereference. This row therefore stands on
    /// its own as evidence: who, which session, which notice version, which hash, and when.</para>
    ///
    /// <para><b>What it does NOT claim.</b> <paramref name="recordedAtUtc"/> is when the linkage
    /// was recorded, not when the farmer accepted. The acceptance time lives on the original row.
    /// Stamping this row with the earlier moment would be back-dating a legal record to make the
    /// chain look tidier than it is.</para>
    /// </remarks>
    public static TermsAcceptanceEvent LinkToUser(Guid id, ConsentLedgerFacts facts, DateTime recordedAtUtc)
    {
        if (facts.UserId is null)
        {
            throw new ArgumentException(
                "LinkToUser requires a real account id — a linking row with no user attaches "
                + "nothing to nobody, which is the defect this method exists to close.",
                nameof(facts));
        }

        return new(id, TermsAcceptanceLinkedEventType, facts, ConsentRecordStatus.Granted, recordedAtUtc);
    }
}

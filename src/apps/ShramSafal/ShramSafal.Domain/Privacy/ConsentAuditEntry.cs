// spec: data-principle-spine-2026-05-05/06.1
using System.Text.Json;

namespace ShramSafal.Domain.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — append-only audit row
/// written every time a <see cref="UserConsentState"/> changes.
/// One row per toggle / version bump / revocation. The table is
/// <c>ssf.consent_audit</c>; the migration revokes UPDATE + DELETE so
/// the ledger is append-only by privilege (mirrors the Phase 04
/// audit-events doctrine).
///
/// <para>
/// <b>Independent aggregate.</b> Not embedded under
/// <see cref="UserConsentState"/> because the state aggregate is mutable
/// (rows get updated in place) but the ledger MUST never be — so they
/// own different grant boundaries (audit gets SELECT + INSERT only).
/// </para>
///
/// <para>
/// <b>Forensic provenance fields.</b> <see cref="AppVersion"/>,
/// <see cref="DeviceId"/>, <see cref="IpHash"/> mirror the Phase 04
/// AuditEvent contract — Phase 04 Route A populates them from
/// <c>HttpContext.AuditClaims()</c> at the endpoint and threads them
/// through the command DTO.
/// </para>
///
/// <para>
/// <b>Old/new state JSON.</b> Serialized form of both
/// <see cref="UserConsentState"/> snapshots so a DPDP §16 export can
/// reconstruct the exact diff a counsel review needs ("which purposes
/// changed, what was the prior agreement version, was a withdrawal
/// stamped this time"). The columns are <c>jsonb</c> in Postgres so the
/// export can JSON-query without re-parsing in C#.
/// </para>
/// </summary>
public sealed class ConsentAuditEntry
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string OldStateJson { get; private set; } = string.Empty;
    public string NewStateJson { get; private set; } = string.Empty;
    public Guid ActorUserId { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
    public int ConsentTextVersion { get; private set; }

    /// <summary>"mr-IN" | "hi-IN" | "en-IN" (or another DPDP §5 language).</summary>
    public string LanguageShown { get; private set; } = string.Empty;

    public string AppVersion { get; private set; } = string.Empty;
    public string DeviceId { get; private set; } = string.Empty;
    public string IpHash { get; private set; } = string.Empty;

    private ConsentAuditEntry()
    {
        // EF Core materialisation; do not call.
    }

    /// <summary>
    /// Build a new audit row capturing the diff between
    /// <paramref name="oldState"/> and <paramref name="newState"/>.
    /// All provenance fields are mandatory — empty / whitespace throws
    /// so a partial audit row cannot reach the DB. Mirrors the
    /// AuditEventFactory.Create discipline from Phase 04.
    /// </summary>
    public static ConsentAuditEntry Create(
        Guid userId,
        UserConsentState oldState,
        UserConsentState newState,
        Guid actorUserId,
        int consentTextVersion,
        string languageShown,
        string appVersion,
        string deviceId,
        string ipHash,
        DateTime nowUtc)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId required", nameof(userId));
        }
        if (oldState is null)
        {
            throw new ArgumentNullException(nameof(oldState));
        }
        if (newState is null)
        {
            throw new ArgumentNullException(nameof(newState));
        }
        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException("actorUserId required", nameof(actorUserId));
        }
        if (consentTextVersion < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(consentTextVersion), consentTextVersion,
                "consent text version must be >= 1");
        }
        if (string.IsNullOrWhiteSpace(languageShown))
        {
            throw new ArgumentException("languageShown required", nameof(languageShown));
        }
        if (string.IsNullOrWhiteSpace(appVersion))
        {
            throw new ArgumentException("appVersion required", nameof(appVersion));
        }
        if (string.IsNullOrWhiteSpace(deviceId))
        {
            throw new ArgumentException("deviceId required", nameof(deviceId));
        }
        if (string.IsNullOrWhiteSpace(ipHash))
        {
            throw new ArgumentException("ipHash required", nameof(ipHash));
        }

        return new ConsentAuditEntry
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            OldStateJson = JsonSerializer.Serialize(SnapshotOf(oldState), SerializerOptions),
            NewStateJson = JsonSerializer.Serialize(SnapshotOf(newState), SerializerOptions),
            ActorUserId = actorUserId,
            OccurredAtUtc = nowUtc,
            ConsentTextVersion = consentTextVersion,
            LanguageShown = languageShown.Trim(),
            AppVersion = appVersion.Trim(),
            DeviceId = deviceId.Trim(),
            IpHash = ipHash.Trim(),
        };
    }

    /// <summary>
    /// Flat DTO used for JSON serialisation. Avoids serialising EF
    /// shadow state / private-set quirks; the audit ledger only cares
    /// about the user-facing surface.
    /// </summary>
    private static object SnapshotOf(UserConsentState state) => new
    {
        userId = state.UserId,
        fullHistoryJournal = state.FullHistoryJournal,
        crossFarmAggregation = state.CrossFarmAggregation,
        researchCorpusExport = state.ResearchCorpusExport,
        // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.11 / ADR-DS-014 §C — emit
        // the two new toggles in the audit-row snapshot so the DPDP §16
        // export sees every consent surface a user agreed to. Legacy
        // audit rows authored before this column landed simply won't
        // include the keys; jsonb readers tolerate the absence.
        verbatimTrainingCorpus = state.VerbatimTrainingCorpus,
        englishTranslationForAdmin = state.EnglishTranslationForAdmin,
        version = state.Version,
        grantedAtUtc = state.GrantedAtUtc,
        withdrawnAtUtc = state.WithdrawnAtUtc,
        currentTokenKid = state.CurrentTokenKid,
    };
}

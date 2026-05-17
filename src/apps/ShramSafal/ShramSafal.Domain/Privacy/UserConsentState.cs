// spec: data-principle-spine-2026-05-05/06.1
namespace ShramSafal.Domain.Privacy;

// OQ-1 (conflict-resolver 2026-05-17): consent lives in the ShramSafal
// bounded context, NOT on User.Domain.Identity.User. Co-located with the
// Phase 05 Privacy siblings (DpaRecord, CrossBorderTransfer) under the
// existing ShramSafal.Domain.Privacy namespace.
//
// The namespace stays at ShramSafal.Domain.* (not the OQ-1-original
// AgriSync.ShramSafal.Domain.*): Phase 05.5/05.6 already documented why
// the AgriSync.* prefix collides with Bootstrapper name resolution; see
// DpaRecord.cs for the full reasoning.

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — live consent-state row
/// for a single user. Three independent purpose toggles (DPDP §7(1)
/// purpose limitation), an immutable version stamp tracking the consent
/// text the user agreed to, and the issuance/revocation timestamps that
/// drive the §6(4) withdrawal audit.
///
/// <para>
/// <b>One row per user.</b> <see cref="UserId"/> is the primary key.
/// First toggle creates the row (see <c>UpdateConsentHandler</c>);
/// subsequent toggles mutate it. All three booleans default to
/// <c>false</c> — consent is opt-in per purpose.
/// </para>
///
/// <para>
/// <b>Immutability of historical state.</b> The instance is sealed
/// with private setters; <see cref="Update"/> returns a NEW instance so
/// audit diff capture (<c>ConsentAuditEntry</c>) can compare old vs
/// new without mutation bleeding back into the captured "before".
/// </para>
///
/// <para>
/// <b>RLS exemption (Phase 06 envelope decision).</b> The companion
/// migration ships WITHOUT Row-Level Security on
/// <c>ssf.user_consent_state</c> + <c>ssf.consent_audit</c>: the rows
/// are user-keyed not farm-keyed, so the Phase 03 RLS policy keyed on
/// <c>agrisync.farm_id</c> would filter every row out. Defence is at
/// the handler boundary via <c>ICurrentUser</c> (the endpoint reads
/// <c>sub</c> from the JWT and the handler scopes every read/write to
/// that user). See <c>RlsExemptionAllowlistTests</c> and ADR-DS-008.
/// </para>
///
/// <para>
/// <b>StricterWins.</b> A client may present a cached consent token whose
/// claims are stale (the user revoked on a different device since).
/// <see cref="StricterWins"/> intersects the token claims with the
/// authoritative server state — any purpose that is <c>false</c> on
/// either side stays <c>false</c>. Server is authoritative; the token
/// only NARROWS scope, never widens it.
/// </para>
/// </summary>
public sealed class UserConsentState
{
    /// <summary>Primary key. The user this row describes.</summary>
    public Guid UserId { get; private set; }

    /// <summary>
    /// §1 — retain voice notes beyond the 30-day local journal so the
    /// user can scroll their full history.
    /// </summary>
    public bool FullHistoryJournal { get; private set; }

    /// <summary>
    /// §2 — allow de-identified data to train product features that
    /// benefit other farmers on the platform.
    /// </summary>
    public bool CrossFarmAggregation { get; private set; }

    /// <summary>
    /// §3 — allow de-identified data to be shared with research /
    /// government partners under DPA-governed export.
    /// </summary>
    public bool ResearchCorpusExport { get; private set; }

    /// <summary>
    /// Version stamp of the consent text the user agreed to. Bumps when
    /// counsel approves a new agreement; an audit row is written every
    /// time the version on a save changes.
    /// </summary>
    public int Version { get; private set; }

    /// <summary>
    /// First time the user granted any consent on this row. Null when the
    /// row has never had any grant (initial default-constructed state).
    /// Not cleared on revocation — kept so the audit trail can answer
    /// "when did this user first opt in" after a later full withdrawal.
    /// </summary>
    public DateTime? GrantedAtUtc { get; private set; }

    /// <summary>
    /// Stamped when the user toggles any previously-granted purpose
    /// back to <c>false</c>. Reset to null on the next grant — so a user
    /// who grants → revokes → grants ends up with the latest grant date
    /// in <see cref="GrantedAtUtc"/> and null here.
    /// </summary>
    public DateTime? WithdrawnAtUtc { get; private set; }

    /// <summary>
    /// Key identifier of the consent token that was current the last time
    /// this state was issued (so a future server-side check can detect
    /// "the token the client presented was minted before this state's
    /// most recent revocation"). Null until the first
    /// <c>IConsentTokenService.IssueAsync</c> stamp.
    /// </summary>
    public string? CurrentTokenKid { get; private set; }

    private UserConsentState()
    {
        // EF Core materialisation; do not call.
    }

    /// <summary>
    /// Factory for a brand-new row in its default state — all three
    /// purposes <c>false</c>, version 1, no timestamps, no token kid.
    /// Use this when <c>UpdateConsentHandler</c> sees no existing row for
    /// the caller and needs to materialise one before applying the toggle.
    /// </summary>
    public static UserConsentState Create(Guid userId)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId required", nameof(userId));
        }

        return new UserConsentState
        {
            UserId = userId,
            FullHistoryJournal = false,
            CrossFarmAggregation = false,
            ResearchCorpusExport = false,
            Version = 1,
            GrantedAtUtc = null,
            WithdrawnAtUtc = null,
            CurrentTokenKid = null,
        };
    }

    /// <summary>
    /// Returns a NEW <see cref="UserConsentState"/> with the supplied
    /// purpose toggles applied. <c>null</c> on a toggle keeps the current
    /// value. The returned instance preserves the current
    /// <see cref="UserId"/> and stamps <see cref="GrantedAtUtc"/> when
    /// transitioning from "never granted" to "any grant".
    ///
    /// <para>
    /// <b>Revocation detection.</b> Any current <c>true</c> flipping to
    /// <c>false</c> stamps <see cref="WithdrawnAtUtc"/>. Any new grant
    /// (false → true) clears <see cref="WithdrawnAtUtc"/> back to null —
    /// the field tracks the most-recent active withdrawal, not the
    /// historical first withdrawal (the audit ledger holds that).
    /// </para>
    /// </summary>
    public UserConsentState Update(
        bool? fullHistoryJournal,
        bool? crossFarmAggregation,
        bool? researchCorpusExport,
        int consentTextVersion,
        string? currentTokenKid,
        DateTime nowUtc)
    {
        if (consentTextVersion < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(consentTextVersion), consentTextVersion,
                "consent text version must be >= 1");
        }

        var nextFullHistory = fullHistoryJournal ?? FullHistoryJournal;
        var nextCrossFarm = crossFarmAggregation ?? CrossFarmAggregation;
        var nextResearch = researchCorpusExport ?? ResearchCorpusExport;

        var anyNewlyGranted =
            (!FullHistoryJournal && nextFullHistory) ||
            (!CrossFarmAggregation && nextCrossFarm) ||
            (!ResearchCorpusExport && nextResearch);

        var anyRevoked =
            (FullHistoryJournal && !nextFullHistory) ||
            (CrossFarmAggregation && !nextCrossFarm) ||
            (ResearchCorpusExport && !nextResearch);

        var nextGrantedAt = GrantedAtUtc;
        if (anyNewlyGranted && (nextFullHistory || nextCrossFarm || nextResearch))
        {
            // First time we see any "true" — stamp grant. Subsequent
            // grants on an already-granted row keep the original
            // GrantedAtUtc (DPDP audit "when did consent start").
            nextGrantedAt ??= nowUtc;
        }

        // WithdrawnAtUtc semantics: stamped on revocation, cleared on
        // subsequent regrant. Mirrors the user-facing intuition "this
        // state is currently withdrawn vs currently granted".
        DateTime? nextWithdrawnAt = WithdrawnAtUtc;
        if (anyRevoked)
        {
            nextWithdrawnAt = nowUtc;
        }
        else if (anyNewlyGranted)
        {
            nextWithdrawnAt = null;
        }

        return new UserConsentState
        {
            UserId = UserId,
            FullHistoryJournal = nextFullHistory,
            CrossFarmAggregation = nextCrossFarm,
            ResearchCorpusExport = nextResearch,
            Version = consentTextVersion,
            GrantedAtUtc = nextGrantedAt,
            WithdrawnAtUtc = nextWithdrawnAt,
            CurrentTokenKid = string.IsNullOrWhiteSpace(currentTokenKid)
                ? CurrentTokenKid
                : currentTokenKid.Trim(),
        };
    }

    /// <summary>
    /// Stricter-wins intersection. Used at the AI / upload boundary when
    /// a cached client token presents consent claims that may be stale
    /// against the authoritative server state. Any purpose that is
    /// <c>false</c> on either side stays <c>false</c> in the result —
    /// the server can NARROW the token's scope but the token cannot
    /// widen the server's scope.
    /// </summary>
    public static UserConsentState StricterWins(UserConsentState clientToken, UserConsentState server)
    {
        if (clientToken is null)
        {
            throw new ArgumentNullException(nameof(clientToken));
        }
        if (server is null)
        {
            throw new ArgumentNullException(nameof(server));
        }

        return new UserConsentState
        {
            UserId = server.UserId,
            FullHistoryJournal = clientToken.FullHistoryJournal && server.FullHistoryJournal,
            CrossFarmAggregation = clientToken.CrossFarmAggregation && server.CrossFarmAggregation,
            ResearchCorpusExport = clientToken.ResearchCorpusExport && server.ResearchCorpusExport,
            // Version: highest wins (mirrors the plan §6.1 sketch — the
            // newer text version was approved by counsel later).
            Version = Math.Max(clientToken.Version, server.Version),
            // GrantedAtUtc: earliest non-null (the user really did grant
            // at the earlier of the two stamps).
            GrantedAtUtc = EarliestOrNull(clientToken.GrantedAtUtc, server.GrantedAtUtc),
            // WithdrawnAtUtc: latest of the two (revocation is the
            // narrower side; the more recent revocation reflects the
            // current state of withdrawal).
            WithdrawnAtUtc = LatestOrNull(clientToken.WithdrawnAtUtc, server.WithdrawnAtUtc),
            CurrentTokenKid = server.CurrentTokenKid,
        };
    }

    private static DateTime? EarliestOrNull(DateTime? a, DateTime? b) =>
        (a, b) switch
        {
            (null, null) => null,
            (null, var x) => x,
            (var x, null) => x,
            (var x, var y) => x! < y! ? x : y,
        };

    private static DateTime? LatestOrNull(DateTime? a, DateTime? b) =>
        (a, b) switch
        {
            (null, null) => null,
            (null, var x) => x,
            (var x, null) => x,
            (var x, var y) => x! > y! ? x : y,
        };
}

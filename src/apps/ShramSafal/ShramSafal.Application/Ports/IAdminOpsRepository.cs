using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Admin ops read-only port. Queries analytics.events directly for
/// live operational health — no materialized view lag.
/// Implementation lives in Infrastructure (AnalyticsDbContext raw SQL).
/// </summary>
public interface IAdminOpsRepository
{
    Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default);

    Task<OpsErrorsPageDto> GetErrorsPagedAsync(
        int page, int pageSize,
        string? endpoint, DateTime? since,
        CancellationToken ct = default);

    Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default);

    // ───────────────────────────────────────────────────────────
    // spec: control-room-app-versions-2026-11-12 (ADR 0028).
    //
    // Unlike the three methods above, NONE of these five degrades to an empty
    // answer. A failed query throws: an empty list here would tell the team
    // that nobody is on an older version.
    // ───────────────────────────────────────────────────────────

    /// <summary>
    /// Every <c>app.seen</c> row the server itself wrote (no actor, role
    /// <c>system</c>) from <paramref name="sinceUtc"/> on, in no particular
    /// order. A row with an actor or any other role was not written by the
    /// server and is never read. A row whose person or version cannot be read
    /// is skipped.
    /// </summary>
    Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>
    /// When the earliest <c>app.seen</c> row the server itself wrote (no
    /// actor, role <c>system</c>) was written; null when there is none.
    /// </summary>
    Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default);

    /// <summary>
    /// Device totals from the sign-in records (<c>public.refresh_tokens</c>)
    /// created or last used from <paramref name="sinceUtc"/> on. Totals only:
    /// no device is ever listed.
    /// </summary>
    Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>
    /// The names on record for these people. A person with no user record is
    /// absent from the answer.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
        IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    /// <summary>
    /// The names of each person's farms (farms they own, and farms where they
    /// hold a membership that is neither revoked nor exited), sorted. A person
    /// on no farm is absent from the answer.
    ///
    /// <para>
    /// This is a cross-farm read, so it goes through the admin factory, which
    /// writes one <c>admin_cross_tenant</c> audit row naming
    /// <paramref name="adminUserId"/> every time it is opened. It is not opened
    /// when <paramref name="personIds"/> is empty.
    /// </para>
    /// </summary>
    Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
        Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    // ───────────────────────────────────────────────────────────
    // spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a Task R1).
    // ───────────────────────────────────────────────────────────

    /// <summary>
    /// What the failure recording wrote from <paramref name="sinceUtc"/> on:
    /// the rows of six event types, newest first, at most 500 (the newest
    /// 500 when there are more), each with its person and that person's
    /// name. No phone number is read.
    ///
    /// <para>
    /// Who wrote a row decides whether it is read, type by type.
    /// <c>api.error</c>, <c>api.slow</c>, <c>api.refused</c> and
    /// <c>sync.mutation_rejected</c> are written by the server, which never
    /// sets an actor: such a row is read only when it has none, and its
    /// person is <c>props.personId</c>. <c>sync.push_outcome</c> arrives from
    /// the app through the ingest route alone, which always sets the sender
    /// as the actor: it is read only when it has one, and its person is that
    /// actor. <c>client.error</c> arrives through ingest or through the app's
    /// failure reporter (<c>POST /telemetry/client-error</c>), which is
    /// anonymous and sets no actor: it is read in either case, and its person
    /// is its actor when it has one and otherwise nobody.
    /// <c>props.personId</c> is never believed on a row a client wrote.
    /// </para>
    ///
    /// <para>
    /// A value inside a row that cannot be read is returned as null (the list
    /// of codes: empty); it never fails the read. <b>A failed query does:</b>
    /// like the five methods above, this one throws. An empty list would say
    /// that nothing failed.
    /// </para>
    /// </summary>
    Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(DateTime sinceUtc, CancellationToken ct = default);
}

/// <summary>One <c>app.seen</c> row: this person used the app on this version at this time.</summary>
public sealed record AppSeenRow(Guid PersonId, string AppVersion, DateTime SeenAtUtc);

/// <summary>
/// Device totals from the sign-in records.
/// </summary>
/// <param name="Phones">Distinct person-and-device pairs whose platform is android and whose device id is known.</param>
/// <param name="OtherDevices">The same for any other platform (browsers).</param>
/// <param name="PeopleWithUnknownDevice">
/// Distinct people with a sign-in whose device id is <c>unknown</c>,
/// <c>legacy</c> or blank (the admin console, and app versions that sent none).
/// </param>
public sealed record SignInDevices(int Phones, int OtherDevices, int PeopleWithUnknownDevice);

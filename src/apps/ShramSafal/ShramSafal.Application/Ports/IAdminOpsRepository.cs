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
    /// Every <c>app.seen</c> row from <paramref name="sinceUtc"/> on, in no
    /// particular order. A row whose person or version cannot be read is
    /// skipped.
    /// </summary>
    Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>When the earliest <c>app.seen</c> row was written; null when there is none.</summary>
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

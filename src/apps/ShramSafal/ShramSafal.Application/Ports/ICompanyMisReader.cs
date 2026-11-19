namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a). Hands over the raw
/// rows the company MIS counts from. Every counting rule lives in
/// <c>CompanyMisCalculator</c>; the reader decides nothing and catches nothing:
/// a failed read escapes so the route answers 500, never an empty answer.
/// </summary>
public interface ICompanyMisReader
{
    /// <param name="adminUserId">The platform admin asking; named in the cross-farm audit row.</param>
    /// <param name="sinceUtc">Earliest row time needed (start of the previous period minus 30 days).</param>
    /// <param name="countedAtUtc">Every read is bounded strictly before this instant.</param>
    /// <param name="excludedUserIds">
    /// Test accounts (amendment A5). Used ONLY to leave their entries out of each
    /// farm's first- and last-entry aggregates; every other exclusion is applied
    /// by the calculator.
    /// </param>
    Task<CompanyMisRows> ReadAsync(
        Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
        CancellationToken ct = default);

    /// <summary>
    /// Plan CR-2c, amendment E3: everything <see cref="ReadAsync"/> reads, plus the
    /// Company MIS additions (the members of <see cref="CompanyMisRows"/> declared in
    /// its body), in the same single pass over the farms (farm keys listed once, one
    /// audit row). Called ONLY by the Company MIS handler, so the voice check and the
    /// silent-farms list, which call <see cref="ReadAsync"/>, pay nothing for them.
    /// </summary>
    /// <param name="additionsSinceUtc">
    /// Earliest instant the additions need: 00:00 India time of the previous period's
    /// first day (amendment E6). Not before <paramref name="sinceUtc"/> and not after
    /// <paramref name="countedAtUtc"/>.
    /// </param>
    Task<CompanyMisRows> ReadForCompanyMisAsync(
        Guid adminUserId, DateTime sinceUtc, DateTime additionsSinceUtc, DateTime countedAtUtc,
        IReadOnlySet<Guid> excludedUserIds, CancellationToken ct = default);
}

/// <summary>
/// The row bundle. <see cref="FarmsListed"/> is the number of farm keys the
/// admin listing returned; <see cref="FarmsNotReadable"/> the keys whose farm
/// row did not come back under row-level security. <see cref="LiveCountSkipped"/>
/// (amendment A1) is true when more farms were listed than the live-count
/// ceiling allows, in which case no per-farm rows were read.
/// </summary>
public sealed record CompanyMisRows(
    int FarmsListed,
    int FarmsNotReadable,
    IReadOnlyList<MisFarmRow> Farms,
    IReadOnlyList<MisEntryRow> Entries,
    IReadOnlyList<MisMembershipRow> Memberships,
    IReadOnlyList<MisPlotRow> Plots,
    IReadOnlyList<MisVoiceJobRow> VoiceJobs,
    IReadOnlyList<MisUserRow> VerifiedUsers,
    IReadOnlyList<MisFpoScopeRow> FpoScopes,
    bool LiveCountSkipped = false)
{
    // ---- Company MIS additions (plan CR-2c). Read only by ICompanyMisReader.ReadForCompanyMisAsync;
    // amendment E3: empty by default, so ReadAsync and its callers pay nothing for them.

    /// <summary>
    /// #52: <c>app.seen</c> rows the server itself wrote (no actor, role <c>system</c>), from the start of the
    /// previous period up to the counting instant. Every person, test accounts included; the calculator leaves
    /// test accounts out.
    /// </summary>
    public IReadOnlyList<MisAppSeenRow> AppSeen { get; init; } = [];

    /// <summary>
    /// #52: when the first <c>app.seen</c> row the server wrote was written (all time); null when there is none.
    /// Set by the handler from <c>IAdminOpsRepository.GetAppSeenStartAsync</c> (amendment E9).
    /// </summary>
    public DateTime? AppSeenStartUtc { get; init; }

    /// <summary>
    /// #10, #49: each read farm's <c>daily_richness_aggregates</c> rows with <c>local_date</c> from the previous
    /// period's first India day to the counting day, read under the farm's row-level security.
    /// </summary>
    public IReadOnlyList<MisUnderstandingDayRow> UnderstandingDays { get; init; } = [];

    /// <summary>
    /// #47, #50: per India day from the previous period's first day to the counting day, the refused attempts and the
    /// accepted changes of phone sync. Every upload, test accounts included (they record no person on the accepted
    /// side). Days with neither are absent.
    /// </summary>
    public IReadOnlyList<MisSyncDayRow> SyncDays { get; init; } = [];
}

/// <summary>
/// LastEntryUtc and FirstEntryUtc are the farm's latest and earliest entry of all
/// time (before the counting instant), leaving out entries saved by excluded
/// accounts; null when there is none (amendment A5).
/// </summary>
public sealed record MisFarmRow(
    Guid FarmId, Guid OwnerUserId, DateTime CreatedAtUtc, DateTime? LastEntryUtc, DateTime? FirstEntryUtc);

/// <summary>One ssf.daily_logs row. CreatedAtUtc is server arrival time.</summary>
public sealed record MisEntryRow(
    Guid FarmId, Guid OperatorUserId, DateTime CreatedAtUtc, bool IsVoice, int ContentVersion, Guid? SourceAiJobId);

/// <summary>Role is an AppRole name; Status is the MembershipStatus number (3 = Active).</summary>
public sealed record MisMembershipRow(Guid FarmId, Guid UserId, string Role, int Status);

public sealed record MisPlotRow(Guid FarmId, decimal AreaInAcres);

/// <summary>A VoiceToStructuredLog AI job; Status is the AiJobStatus name.</summary>
public sealed record MisVoiceJobRow(
    Guid JobId, Guid FarmId, Guid UserId, DateTime CreatedAtUtc, string Status, IReadOnlyList<int> SuccessfulLatenciesMs);

public sealed record MisUserRow(Guid UserId, DateTime PhoneVerifiedAtUtc);

public sealed record MisFpoScopeRow(Guid FarmId, string OrganizationName, DateTime GrantedAtUtc);

/// <summary>
/// One <c>app.seen</c> row (plan CR-2c, #52). Platform is <c>props-&gt;&gt;'platform'</c> as stored: the server
/// writes the literal <c>android</c> for the native Android app and no key otherwise, so null means "not the
/// Android app" (D-141's default, amendment E9).
/// </summary>
/// <summary>
/// One <c>daily_richness_aggregates</c> row, one farm-day (plan CR-2c, #10, #49). DayClassification is the stored
/// <c>DayClassification</c> name. Score is <c>CompanyMisCalculator.UnderstandingScoreOf(components_json)</c>, worked
/// out as the row is read so the breakdown itself is not held: null when nothing in it can be scored or it cannot
/// be read (amendment E5: such a row is left out of the count, never a 0).
/// </summary>
public sealed record MisUnderstandingDayRow(Guid FarmId, DateOnly LocalDate, string DayClassification, int? Score);

/// <summary>
/// One India day of phone sync (plan CR-2c, #47, #50, amendment E2). RefusedAttempts = the sum of the guarded
/// <c>rejectedWorkItems</c> of the server-written <c>sync.mutation_rejected</c> rows that day (one row per request; a
/// change the phone sends again is refused again, and counted again). AcceptedChanges = the
/// <c>ssf.sync_mutations</c> rows processed that day (one per change; a unique index removes repeats).
/// </summary>
public sealed record MisSyncDayRow(DateOnly Day, int RefusedAttempts, int AcceptedChanges);

public sealed record MisAppSeenRow(Guid PersonId, string AppVersion, DateTime SeenAtUtc, string? Platform);

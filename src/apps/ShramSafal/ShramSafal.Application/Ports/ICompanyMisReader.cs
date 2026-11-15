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
    Task<CompanyMisRows> ReadAsync(Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default);
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
    bool LiveCountSkipped = false);

public sealed record MisFarmRow(Guid FarmId, Guid OwnerUserId, DateTime CreatedAtUtc, DateTime? LastEntryUtc);

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

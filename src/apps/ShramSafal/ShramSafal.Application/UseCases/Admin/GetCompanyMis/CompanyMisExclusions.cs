namespace ShramSafal.Application.UseCases.Admin.GetCompanyMis;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15. The user ids of test accounts
/// left out of every company count. Parsing from configuration follows in the
/// counting-rules task.
/// </summary>
public sealed record CompanyMisExclusions(IReadOnlySet<Guid> UserIds);

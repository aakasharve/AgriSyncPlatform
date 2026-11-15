using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetCompanyMis;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15. Placeholder: the counting rules
/// land in the next commit of this lane (plan CR-2a Task 2).
/// </summary>
public static class CompanyMisCalculator
{
    public static CompanyMisDto Compute(
        CompanyMisRows rows,
        CompanyMisExclusions exclusions,
        DateOnly from,
        DateOnly to,
        DateOnly previousFrom,
        DateOnly previousTo,
        DateTime countedAtUtc) =>
        throw new NotImplementedException("Company MIS counting rules are not implemented yet (plan CR-2a Task 2).");
}

using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.GetLabourData;

/// <summary>
/// Task 1.2 (spec: 2026-07-13-labour-attendance-approval-design) — assembles
/// the farm's Option-3 wage-book read-model (<c>LabourDataDto</c>) from
/// EXISTING engines (memberships, job cards, cost entries, labour
/// assignments, daily-log verification). No new tables.
/// </summary>
public sealed record GetLabourDataQuery(FarmId FarmId, UserId CallerUserId);

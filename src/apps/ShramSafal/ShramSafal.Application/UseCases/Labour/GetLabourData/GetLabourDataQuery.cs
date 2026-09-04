using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.GetLabourData;

/// <summary>
/// Task 1.2 (spec: 2026-07-13-labour-attendance-approval-design) — assembles
/// the farm's Option-3 wage-book read-model (<c>LabourData</c>) from
/// EXISTING engines (memberships, job cards, cost entries, labour
/// assignments, daily-log verification). No new tables.
/// </summary>
/// <param name="Window">
/// Task 9 (spec: 2026-08-28-labour-v2-release-1) — the adjustable time window:
/// <c>alltime</c> (आजपर्यंत) / <c>today</c> (आज) / <c>week</c> (हा आठवडा) /
/// <c>month</c> (हा महिना). See <see cref="LabourTimeWindow"/> for the exact
/// dates each resolves to and why they are IST-anchored.
///
/// <para>OPTIONAL, and omitted means <c>alltime</c> — the founder-chosen
/// default. That is what lets a client shipped before this parameter existed
/// keep calling the endpoint unchanged. It is carried as a raw <c>string?</c>
/// (not an enum) so the endpoint stays a plain minimal-API query parameter and
/// an unrecognised value is rejected by the handler with a domain error rather
/// than by model binding with an opaque 400 — the same shape
/// <c>GetFinanceSummaryQuery.GroupBy</c> / <c>NormalizeGroupBy</c> already
/// uses.</para>
/// </param>
public sealed record GetLabourDataQuery(FarmId FarmId, UserId CallerUserId, string? Window = null);

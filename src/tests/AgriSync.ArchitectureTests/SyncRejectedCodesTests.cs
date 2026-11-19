// spec: control-room-go-live-must-haves-2026-11-10
// ADR 0027 D3 / D7 — plan CR-1a Task K2.

using FluentAssertions;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// The rule that decides which error codes a refused sync save records.
///
/// <para>
/// It is tested as a pure function on purpose. <c>POST /sync/push</c> answers
/// 200 while refusing work inside it, and what it tells the observability
/// middleware travels on <c>HttpContext.Items</c> — which the HTTP-only sync
/// harness cannot see. So the endpoint's part is reduced to one function with
/// no request in it, and
/// <c>RequestObservabilityMiddlewareTests.The_middleware_passes_stamped_codes_to_the_row</c>
/// proves the other half: whatever is stamped reaches the row.
/// </para>
///
/// <para>
/// The rule: the <c>ErrorCode</c> of every result whose <c>Status</c> is
/// <see cref="PushSyncBatchHandler.RejectedStatus"/>, nulls skipped, each code
/// once, ordinal-sorted, at most ten. Codes only — a result's
/// <c>ErrorMessage</c> can carry interpolated text and never enters the row
/// (<c>analytics.events</c> is append-only).
/// </para>
/// </summary>
public sealed class SyncRejectedCodesTests
{
    private static SyncMutationResultDto Refused(string? code) => new(
        ClientRequestId: Guid.NewGuid().ToString("D"),
        MutationType: "create_daily_log",
        Status: PushSyncBatchHandler.RejectedStatus,
        Data: null,
        ErrorCode: code,
        ErrorMessage: code is null ? null : "text that must never be recorded");

    /// <summary>A result the server did not refuse ("applied", "duplicate").</summary>
    private static SyncMutationResultDto NotRefused(string status, string? code = null) => new(
        ClientRequestId: Guid.NewGuid().ToString("D"),
        MutationType: "create_daily_log",
        Status: status,
        Data: null,
        ErrorCode: code,
        ErrorMessage: null);

    [Fact]
    public void Distinct_rejected_codes_names_each_code_once()
    {
        // Refused B, A, A — and one result that was NOT refused yet carries a
        // code C, so only the status can be what keeps it out.
        var results = new[]
        {
            Refused("ShramSafal.PlotNotFound"),
            Refused("ShramSafal.CropCycleOverlap"),
            NotRefused("applied", code: "ShramSafal.DuplicateLogRequest"),
            Refused("ShramSafal.CropCycleOverlap"),
            NotRefused("duplicate"),
        };

        var codes = SyncEndpoints.DistinctRejectedCodes(results);

        // Each code once, and in ordinal order rather than arrival order: the
        // same batch re-sent in a different order must record the same row.
        codes.Should().Equal("ShramSafal.CropCycleOverlap", "ShramSafal.PlotNotFound");

        // ORDINAL, not the culture's alphabet. Two made-up codes chosen to
        // tell the two apart: 'Z' (0x5A) sorts before 'a' (0x61), where a
        // culture-aware sort puts "alpha" first. A plain OrderBy(c => c) is
        // culture-aware, so its answer could depend on the machine it ran on.
        SyncEndpoints.DistinctRejectedCodes(new[] { Refused("alpha.code"), Refused("Zeta.Code") })
            .Should().Equal("Zeta.Code", "alpha.code");
    }

    [Fact]
    public void Distinct_rejected_codes_skips_results_with_no_code()
    {
        var results = new[]
        {
            Refused(null),
            Refused("ShramSafal.CropCycleOverlap"),
            Refused(null),
        };

        // A refusal with no code is still counted by rejectedWorkItems; it
        // simply has no name to add. It never becomes a null in the list.
        SyncEndpoints.DistinctRejectedCodes(results)
            .Should().Equal("ShramSafal.CropCycleOverlap");

        // Nothing to name is an EMPTY array, never null: the endpoint stamps
        // the codes only when the array is not empty.
        SyncEndpoints.DistinctRejectedCodes(new[] { Refused(null), Refused(null) })
            .Should().NotBeNull().And.BeEmpty();

        SyncEndpoints.DistinctRejectedCodes(Array.Empty<SyncMutationResultDto>())
            .Should().NotBeNull().And.BeEmpty();

        // A batch in which nothing was refused names nothing.
        SyncEndpoints.DistinctRejectedCodes(new[] { NotRefused("applied"), NotRefused("duplicate") })
            .Should().BeEmpty();
    }

    [Fact]
    public void More_than_ten_distinct_codes_are_cut_to_ten()
    {
        // Twelve distinct refused codes, arriving in REVERSE ordinal order
        // (Refusal.12 first), each twice.
        var results = Enumerable.Range(1, 12)
            .Reverse()
            .SelectMany(i => new[] { Refused($"Refusal.{i:00}"), Refused($"Refusal.{i:00}") })
            .ToArray();

        var codes = SyncEndpoints.DistinctRejectedCodes(results);

        codes.Should().HaveCount(10,
            "one farmer re-syncing a long queue must not write an unbounded list into an append-only row");

        // Sorted FIRST, cut SECOND: the ten kept are the ordinal-first ten,
        // whatever order they arrived in. Cutting before sorting would keep
        // Refusal.03 to Refusal.12 here, and which codes survive would depend
        // on the order of the farmer's queue.
        codes.Should().Equal(
            "Refusal.01", "Refusal.02", "Refusal.03", "Refusal.04", "Refusal.05",
            "Refusal.06", "Refusal.07", "Refusal.08", "Refusal.09", "Refusal.10");

        // Exactly ten is not cut.
        SyncEndpoints.DistinctRejectedCodes(results.Where(r => r.ErrorCode != "Refusal.11" && r.ErrorCode != "Refusal.12"))
            .Should().HaveCount(10);
    }
}

using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Wtl;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Infrastructure.Wtl;

/// <summary>
/// WTL v0 projector that subscribes to <see cref="DailyLogCreatedEvent"/>
/// and runs the regex worker-name extractor over the originating
/// transcript. For each extracted name it find-or-creates a
/// <c>Worker</c>, links a <c>WorkerAssignment</c>, and emits a
/// <c>worker.named</c> analytics event.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §2.10. The projector is the only writer of
/// <see cref="Worker"/> and <see cref="WorkerAssignment"/> aggregates;
/// admin Mode A drilldown is the primary reader. There is no
/// farmer-facing API.
/// </para>
/// <para>
/// <b>Founder-owned boundary.</b> §1.5.2 #12 forbids touching
/// <c>ParseVoiceHandler</c>, <c>ExtractReceiptHandler</c>, or
/// <c>ExtractPattiHandler</c>. The projector consumes the existing
/// <see cref="DailyLogCreatedEvent"/> via the outbox dispatcher; the AI
/// pipeline is untouched.
/// </para>
/// <para>
/// <b>Transcript availability.</b> Transcripts are not persisted directly
/// on the <see cref="Domain.Logs.DailyLog"/> aggregate; the projector
/// fetches them via <see cref="IDailyLogTranscriptStore"/>, which (as of
/// Task 2.4, spec 2026-07-13-labour-attendance-approval-design) resolves
/// the log's <c>SourceAiJobId</c> to the warm-tier
/// <see cref="Domain.AI.Transcript"/> row for that AI job
/// (<c>DailyLogTranscriptStore</c>). Manual logs (no <c>SourceAiJobId</c>)
/// or logs whose transcript was never persisted still resolve to null, and
/// the projector gracefully no-ops in that case — see
/// <c>DailyLogTranscriptStore</c>'s remarks for why some voice transcripts
/// legitimately still resolve to null-or-redacted text (a separate
/// third-party PII control, not a gap in this store).
/// </para>
/// <para>
/// <b>No cross-log merge by name (2026-07-19, founder Decision 5 sub-question 2,
/// spec 2026-07-13-labour-attendance-approval-design).</b> Earlier revisions of
/// this projector found-or-created a <see cref="Worker"/> by exact normalized
/// name PER FARM, across every <see cref="Domain.Logs.DailyLog"/> ever seen —
/// so two different real people sharing a common Marathi name (e.g. रमेश) on
/// the same farm silently collapsed into ONE <see cref="Worker"/> row. That was
/// tolerable while worker rows were admin-only analytics with no farmer-facing
/// surface; it stopped being tolerable the moment names ship and any
/// reputation or money can attach to a Worker identity. There is no verified
/// signal (e.g. a phone number) available today to tell two same-named people
/// apart — and ADR 0026 (Worker Identity Ladder) is Proposed/unsigned and
/// explicitly forbids building any real name-matching link path ahead of
/// founder sign-off. So the projector no longer attempts cross-invocation
/// reuse at all: EVERY extracted name creates its own brand-new
/// <see cref="Worker"/> row, scoped to the single <c>DailyLogCreatedEvent</c>
/// that produced it. This guarantees the merge hazard cannot occur, at the
/// cost of no longer aggregating "same person, multiple days" — that
/// aggregation is deferred to WTL v1, once a verified identity signal exists.
/// The ONLY dedupe that still happens is within a single transcript (the
/// <c>seenInThisInvocation</c> set below) — repeated mentions of the same
/// name in ONE utterance are still assumed to be the same person, because
/// that is a single controlled context, not a cross-log identity claim.
/// </para>
/// <para>
/// <b>Idempotency (unchanged, pre-existing gap).</b> The outbox dispatcher
/// delivers at-least-once, and there is still no unique constraint on
/// <c>WorkerAssignment(WorkerId, DailyLogId)</c>, so a redelivered event for
/// the same log can still produce a duplicate Worker/WorkerAssignment pair.
/// This is a pre-existing data-quality gap (not the identity-merge hazard
/// above) — a future EF unique index on that tuple, or an event-id-keyed
/// idempotency ledger, closes it. Out of scope for this fix.
/// </para>
/// </remarks>
public sealed class WorkerNameProjector(
    IDailyLogTranscriptStore transcriptStore,
    IWorkerRepository workers,
    IWorkerNameExtractor extractor,
    IAnalyticsWriter analytics,
    IClock clock,
    ILogger<WorkerNameProjector> logger) : IWorkerNameProjector
{
    public async Task HandleAsync(DailyLogCreatedEvent domainEvent, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(domainEvent);

        var transcript = await transcriptStore.GetTranscriptAsync(domainEvent.DailyLogId, cancellationToken);
        if (string.IsNullOrWhiteSpace(transcript))
        {
            // Expected case until transcript persistence lands. Logged at
            // Debug so production traces aren't polluted but the path is
            // visible during dev/staging troubleshooting.
            logger.LogDebug(
                "WorkerNameProjector: no transcript for DailyLog {DailyLogId}; skipping.",
                domainEvent.DailyLogId);
            return;
        }

        var rawNames = extractor.ExtractFromMarathiTranscript(transcript);
        if (rawNames.Count == 0)
        {
            return;
        }

        var nowDateTime = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var nowOffset = new DateTimeOffset(nowDateTime);
        var seenInThisInvocation = new HashSet<string>(StringComparer.Ordinal);
        // Every entry here is, by construction of the anti-merge fix above, a
        // brand-new Worker — there is no more "reused existing worker" case,
        // so this is a plain list of the workers created THIS invocation
        // (dropped the now-always-true IsNewWorker flag it used to carry).
        var newWorkers = new List<Worker>();

        foreach (var rawName in rawNames)
        {
            WorkerName name;
            try
            {
                name = WorkerName.From(rawName);
            }
            catch (ArgumentException)
            {
                continue; // Defensive — extractor contract excludes empties already.
            }

            // Within a single invocation, dedupe by normalized name so a
            // transcript that says "रमेश आणि रमेश" only links one assignment.
            if (!seenInThisInvocation.Add(name.Normalized))
            {
                continue;
            }

            // 2026-07-19 anti-merge fix (see remarks above): always create a
            // brand-new Worker for this invocation. No farm-wide
            // find-or-create by name — that is precisely the behaviour that
            // let two distinct same-named people collapse into one record.
            var worker = new Worker(domainEvent.FarmId, name, nowOffset);
            workers.Add(worker);

            var assignment = new WorkerAssignment(
                workerId: worker.Id,
                dailyLogId: domainEvent.DailyLogId,
                confidence: 0.85m,
                occurredAt: nowOffset);
            workers.AddAssignment(assignment);
            worker.RegisterAssignment();

            newWorkers.Add(worker);
        }

        if (newWorkers.Count == 0)
        {
            return;
        }

        await workers.SaveChangesAsync(cancellationToken);

        // Emit one worker.named analytics event per new assignment.
        // PropsJson follows the v1 vocabulary (DWC v2 ADR §event-vocabulary)
        // — farmId/dailyLogId are also at the top level for index-friendly
        // server-side filtering by the admin drilldown.
        //
        // 2026-07-19 RULING (founder Decision 5 sub-question 1, spec
        // 2026-07-13-labour-attendance-approval-design): this event used to
        // carry the raw name (workerName/normalizedName). analytics.events
        // carries `CREATE RULE ... DO INSTEAD NOTHING` on both UPDATE and
        // DELETE (20260419054331_AnalyticsInitial.cs) — a row written there
        // is physically impossible to scrub or delete at ANY layer, forever.
        // Writing a third party's real name into an append-only,
        // un-scrubbable table would make the erasure story unclosable no
        // matter what the rest of this file does. So the event now carries
        // ONLY workerId — the Worker aggregate's own random v4 Guid primary
        // key. It is a non-identifying reference: resolving it back to a
        // name requires a live DB read of ssf.workers, and once that row is
        // scrubbed by ErasureWorker (see AnonymizeWorkersDerivedFromUserLogsAsync
        // in ErasureWorker.cs), this analytics event no longer points at any
        // recoverable name — it just points at a row that now says "Erased
        // worker". A hash of the name was deliberately NOT used instead:
        // common Marathi first names have very low entropy, so a hash would
        // be trivially reversible by dictionary/rainbow lookup — "stable but
        // reversible" is not actually non-identifying for this data, and
        // would give false confidence. The random Guid has no such
        // shortcut.
        foreach (var worker in newWorkers)
        {
            var propsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = domainEvent.FarmId.Value,
                dailyLogId = domainEvent.DailyLogId,
                workerId = worker.Id,
                confidence = 0.85,
            });

            await analytics.EmitAsync(new AnalyticsEvent(
                EventId: Guid.NewGuid(),
                EventType: "worker.named",
                OccurredAtUtc: nowDateTime,
                ActorUserId: null,
                FarmId: domainEvent.FarmId,
                OwnerAccountId: null,
                ActorRole: "system",
                Trigger: "wtl.projector",
                DeviceOccurredAtUtc: null,
                SchemaVersion: "v1",
                PropsJson: propsJson
            ), cancellationToken);
        }
    }
}

using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Wtl;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Wtl;

/// <summary>
/// Task 2.4 (spec: 2026-07-13-labour-attendance-approval-design) — real
/// <see cref="IDailyLogTranscriptStore"/>. Resolves the originating
/// transcript for a <c>DailyLog</c> by following
/// <see cref="ShramSafal.Domain.Logs.DailyLog.SourceAiJobId"/> to the
/// warm-tier <see cref="ShramSafal.Domain.AI.Transcript"/> row persisted
/// for that AI job (<c>ssf.transcripts</c>, keyed by <c>ai_job_id</c>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why <c>Transcript.Text</c> and not <c>AiJob.TranscriptCodemix</c>.</b>
/// Both fields carry Marathi/code-mix content, so either would satisfy the
/// "not a redacted/English variant" requirement on language grounds alone.
/// They are NOT equivalent on privacy grounds, though: <c>Transcript.Text</c>
/// is the value <see cref="ShramSafal.Application.UseCases.AI.ParseVoiceInput.ParseVoiceInputHandler"/>
/// persists AFTER running the transcript through
/// <see cref="ShramSafal.Application.Ports.Privacy.IThirdPartyPiiDetector"/>
/// (<c>HeuristicWorkerNameDetector</c>) — the third-party PII control that
/// exists specifically to keep un-consented worker names out of the
/// persistently-stored transcript (DATA_PRINCIPLE_SPINE Phase 10 sub-phase
/// 10.1). <c>AiJob.TranscriptCodemix</c> is the RAW STT output stamped by
/// <c>AiOrchestrator</c> BEFORE that detector ever runs, so it never has
/// any redaction applied.
/// </para>
/// <para>
/// This store deliberately reads <c>Transcript.Text</c> — the field the
/// privacy control actually gates — and returns whatever ended up
/// persisted there, redacted or not. It never falls back to
/// <c>AiJob.TranscriptCodemix</c> to "recover" names the detector
/// stripped; doing so would bypass a control that exists specifically to
/// keep non-consenting third parties (workers) out of free-text
/// retention. The practical consequence — <see cref="IWorkerNameExtractor"/>
/// finding fewer names than a raw transcript would yield whenever the
/// detector fired — is a documented, accepted finding (see Task 2.4
/// report), not a bug in this store.
/// </para>
/// <para>
/// Multiple <c>Transcript</c> rows can exist for the same AI job (one per
/// attempt); the most recently produced row is used. Returns
/// <c>null</c> when the log has no <c>SourceAiJobId</c> (manual log) or no
/// transcript row exists for that job — the projector already treats
/// <c>null</c>/whitespace as "no work to do".
/// </para>
/// </remarks>
internal sealed class DailyLogTranscriptStore(ShramSafalDbContext db) : IDailyLogTranscriptStore
{
    public async Task<string?> GetTranscriptAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        var sourceAiJobId = await db.DailyLogs
            .Where(l => l.Id == dailyLogId)
            .Select(l => l.SourceAiJobId)
            .FirstOrDefaultAsync(ct);

        if (sourceAiJobId is null || sourceAiJobId == Guid.Empty)
        {
            return null;
        }

        var text = await db.Transcripts
            .Where(t => t.AiJobId == sourceAiJobId.Value)
            .OrderByDescending(t => t.ProducedAtUtc)
            .Select(t => t.Text)
            .FirstOrDefaultAsync(ct);

        return string.IsNullOrWhiteSpace(text) ? null : text;
    }
}

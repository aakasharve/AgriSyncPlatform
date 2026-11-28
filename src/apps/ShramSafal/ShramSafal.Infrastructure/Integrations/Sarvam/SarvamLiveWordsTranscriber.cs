using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — the live-words transcriber over
/// Sarvam's REST speech-to-text (<see cref="SarvamSttClient.TranscribeShortAsync"/>): the proven call, one phrase at a time.
///
/// <para><b>Why REST, not the streaming socket.</b> The streaming client in this folder (<see cref="SarvamStreamingSttClient"/>) was
/// found on 13 Jun 2026 to return NOTHING for a single-shot clip and has never run on a live recording; Sarvam's current realtime
/// socket (<c>/speech-to-text-realtime/ws</c>: 100 ms chunks, <c>transcript.partial</c> events) is documented but cannot be tried
/// without a paid call, which this lane may not make. The REST call is the one every real recording already uses, so a phrase
/// every few seconds is the part that can be built and proven now. Swapping the transport later changes this class only.</para>
///
/// <para><b>No ledger, no retry, no memory.</b> The words are returned and forgotten: nothing is written to
/// <c>ssf.transcript_history</c> (a live phrase is not a transcript of record), nothing is logged but sizes and timings (a transcript never
/// goes to a log), and a failed phrase is not tried again.</para>
/// </summary>
internal sealed class SarvamLiveWordsTranscriber(
    SarvamSttClient stt,
    LiveWordsGate gate,
    IOptions<SarvamOptions> options,
    ILogger<SarvamLiveWordsTranscriber> logger) : ILiveWordsTranscriber
{
    public bool Enabled => options.Value.LiveWordsEnabled;

    public async Task<LiveWordsResult> TranscribeAsync(byte[] wav, string? languageHint, CancellationToken ct)
    {
        if (!Enabled)
        {
            return LiveWordsResult.Of(LiveWordsOutcome.Unavailable);
        }

        using var lease = gate.TryEnter();
        if (lease is null)
        {
            // Shed, not queued: the real transcription of his recording must never wait behind a preview.
            logger.LogInformation("[live-words] shed (too many live pieces now)");
            return LiveWordsResult.Of(LiveWordsOutcome.Busy);
        }

        var clock = Stopwatch.StartNew();
        try
        {
            var outcome = await stt.TranscribeShortAsync(wav, languageHint, ct).ConfigureAwait(false);
            var ms = (int)clock.ElapsedMilliseconds;
            if (!outcome.IsSuccess)
            {
                // A rate limit, a Sarvam server error or a timeout: back off (Busy). Anything else (key missing, a refused file): Unavailable.
                var result = outcome.Retryable ? LiveWordsOutcome.Busy : LiveWordsOutcome.Unavailable;
                logger.LogWarning("[live-words] Sarvam did not answer a live piece: outcome={Outcome} ms={Ms} bytes={Bytes}", result, ms, wav.Length);
                return LiveWordsResult.Of(result, ms);
            }

            var text = (outcome.Transcript ?? string.Empty).Trim();
            logger.LogInformation("[live-words] ok words={Words} ms={Ms} bytes={Bytes}",
                text.Length == 0 ? 0 : text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length, ms, wav.Length);
            return text.Length == 0
                ? LiveWordsResult.Of(LiveWordsOutcome.Quiet, ms)
                : new LiveWordsResult(LiveWordsOutcome.Words, text, ms);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[live-words] a live piece failed");
            return LiveWordsResult.Of(LiveWordsOutcome.Unavailable, (int)clock.ElapsedMilliseconds);
        }
    }
}

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — the ration for live pieces, ALL farmers together
/// (singleton): at most <see cref="SarvamOptions.LiveWordsMaxConcurrent"/> at the same moment and
/// <see cref="SarvamOptions.LiveWordsMaxPerMinute"/> in any rolling minute. Sarvam's REST limit is one budget shared with the real
/// transcription of his recordings; this keeps the previews to a fixed slice of it and sheds them first.
/// </summary>
internal sealed class LiveWordsGate(IOptions<SarvamOptions> options, TimeProvider? clock = null)
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    private readonly object _lock = new();
    private readonly Queue<DateTimeOffset> _admitted = new();
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private int _inFlight;

    /// <returns>A lease to dispose when the piece is done, or null when the ration is used up.</returns>
    public Lease? TryEnter()
    {
        var o = options.Value;
        var now = _clock.GetUtcNow();
        lock (_lock)
        {
            while (_admitted.Count > 0 && now - _admitted.Peek() >= Window)
            {
                _admitted.Dequeue();
            }

            if (_inFlight >= Math.Max(1, o.LiveWordsMaxConcurrent) || _admitted.Count >= Math.Max(1, o.LiveWordsMaxPerMinute))
            {
                return null;
            }

            _inFlight++;
            _admitted.Enqueue(now);
            return new Lease(this);
        }
    }

    private void Leave()
    {
        lock (_lock)
        {
            _inFlight = Math.Max(0, _inFlight - 1);
        }
    }

    internal sealed class Lease(LiveWordsGate owner) : IDisposable
    {
        private int _left;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _left, 1) == 0)
            {
                owner.Leave();
            }
        }
    }
}

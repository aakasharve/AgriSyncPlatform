// spec: voice-instant-phase-a-2026-11-23 (Task 4 / S4) - the raw-audio write and speech-to-text run beside each other.
//
// Authored from the acceptance criteria only. The fakes are scripted (VoiceSpeedTestKit); the order of events is proven
// with a shared log and gates, not with sleeps, except for one wall-clock check with generous margins.
using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class AiOrchestratorRawAudioBesideSpeechTests
{
    /// <summary>How long a stage waits for the other one to start before the test calls it "not concurrent".</summary>
    private static readonly TimeSpan WaitForTheOther = TimeSpan.FromSeconds(3);

    // =====================================================================================================
    // Beside each other
    // =====================================================================================================

    [Fact]
    public async Task The_raw_audio_write_and_speech_to_text_are_both_in_flight_at_the_same_moment()
    {
        // Each fake starts, then waits for the OTHER one to have started. If the orchestrator ran them one after the
        // other, the first would wait out WaitForTheOther and report that it never saw the second.
        var bothStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = 0;
        void MarkStarted()
        {
            if (Interlocked.Increment(ref started) == 2)
            {
                bothStarted.TrySetResult();
            }
        }

        async Task<bool> SawTheOtherAsync() =>
            await Task.WhenAny(bothStarted.Task, Task.Delay(WaitForTheOther)) == bothStarted.Task;

        var blobSawTheOther = false;
        var sttSawTheOther = false;
        var rig = VsRig.Create(
            blob: new VsBlobStore(async (_, _) =>
            {
                MarkStarted();
                blobSawTheOther = await SawTheOtherAsync();
            }),
            transcriber: new VsTranscriber(async (_, _, _) =>
            {
                MarkStarted();
                sttSawTheOther = await SawTheOtherAsync();
                return VsTranscriber.Words();
            }));

        var (result, _, _, _) = await rig.RunAsync("s4-concurrent-1");

        Assert.True(result.Success, result.Error);
        Assert.True(blobSawTheOther, "the raw-audio write finished before speech-to-text had started: they ran one after the other");
        Assert.True(sttSawTheOther, "speech-to-text finished before the raw-audio write had started: they ran one after the other");
    }

    [Fact]
    public async Task The_stage_ends_when_the_slower_of_the_two_is_released_not_when_their_sum_has_passed()
    {
        // The wall-clock form of this check (a 300 ms write and a 300 ms transcription finishing in under about 450 ms)
        // measured 628 ms once the whole suite was running in parallel: a loaded thread pool delays timers. So "300 ms"
        // is played by gates the test opens itself, and nothing here depends on how fast the machine is.
        var blobGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sttGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var blobStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sttStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var rig = VsRig.Create(
            blob: new VsBlobStore(async (_, ct) =>
            {
                blobStarted.TrySetResult();
                await blobGate.Task.WaitAsync(ct);
            }),
            transcriber: new VsTranscriber(async (_, _, ct) =>
            {
                sttStarted.TrySetResult();
                await sttGate.Task.WaitAsync(ct);
                return VsTranscriber.Words();
            }));

        var run = rig.RunAsync("s4-gates-1");

        // Both are started before either finishes: neither waited for the other.
        var both = Task.WhenAll(blobStarted.Task, sttStarted.Task);
        Assert.Same(both, await Task.WhenAny(both, Task.Delay(TimeSpan.FromSeconds(10))));

        // The write is done, speech-to-text is not: the parse must still be waiting.
        blobGate.SetResult();
        await Task.Delay(60);
        Assert.False(run.IsCompleted, "the parse finished while speech-to-text was still running");

        // Speech-to-text is released: the parse can finish now, with nothing else left to wait for.
        sttGate.SetResult();
        var finished = await Task.WhenAny(run, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(run, finished);
        var (result, _, _, _) = await run;
        Assert.True(result.Success, result.Error);
        Assert.Equal(1, rig.Blob.PutCalls);
        Assert.Equal(1, rig.Transcriber!.Calls);
        Assert.NotNull(result.StageTimings);
    }

    [Fact]
    public async Task A_speech_to_text_that_ends_first_does_not_wait_for_a_slow_write_and_the_parse_still_waits_for_both()
    {
        var rig = VsRig.Create(
            blob: new VsBlobStore(async (_, ct) => await Task.Delay(150, ct)),
            transcriber: new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words())));

        var (result, jobId, _, _) = await rig.RunAsync("s4-slow-write-1");

        Assert.True(result.Success, result.Error);
        var job = await rig.JobAsync(jobId);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef)); // the slow write was awaited, not dropped
        Assert.Single(rig.Blob.Stored);
    }

    // =====================================================================================================
    // A write that fails never fails the parse
    // =====================================================================================================

    [Fact]
    public async Task A_blob_store_that_throws_leaves_the_raw_input_ref_empty_and_the_parse_still_succeeds()
    {
        var rig = VsRig.Create(blob: new VsBlobStore((_, _) => throw new InvalidOperationException("S3 PUT failed: SignatureDoesNotMatch")));

        var (result, jobId, _, _) = await rig.RunAsync("s4-put-throws-1");

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, rig.Transcriber!.Calls);
        var job = await rig.JobAsync(jobId);
        Assert.True(string.IsNullOrWhiteSpace(job.RawInputRef), $"RawInputRef should be empty, was '{job.RawInputRef}'");
        Assert.Equal(AiJobStatus.Succeeded, job.Status);
        Assert.Empty(rig.Index.RawBlobUpserts); // nothing was stored, so nothing is indexed
    }

    [Fact]
    public async Task A_slow_failing_write_does_not_make_speech_to_text_wait_or_fail()
    {
        var rig = VsRig.Create(blob: new VsBlobStore(async (_, ct) =>
        {
            await Task.Delay(120, ct);
            throw new IOException("connection reset");
        }));

        var (result, jobId, _, _) = await rig.RunAsync("s4-put-slow-throws-1");

        Assert.True(result.Success, result.Error);
        Assert.True(string.IsNullOrWhiteSpace((await rig.JobAsync(jobId)).RawInputRef));
    }

    [Fact]
    public async Task A_good_write_stamps_the_audio_hash_on_the_job_and_indexes_it_once()
    {
        var rig = VsRig.Create();

        var (result, jobId, _, _) = await rig.RunAsync("s4-put-ok-1");

        Assert.True(result.Success, result.Error);
        var job = await rig.JobAsync(jobId);
        var stored = Assert.Single(rig.Blob.Stored);
        Assert.Equal(stored.Sha256, job.RawInputRef);
        Assert.Equal(64, job.RawInputRef!.Length);
        var indexed = Assert.Single(rig.Index.RawBlobUpserts);
        Assert.Equal(stored.Sha256, indexed.Sha256);
    }

    // =====================================================================================================
    // A speech-to-text failure never loses the audio
    // =====================================================================================================

    [Fact]
    public async Task A_transcriber_that_fails_still_leaves_the_raw_audio_stored_and_referenced_on_the_job()
    {
        var rig = VsRig.Create(
            transcriber: new VsTranscriber(async (_, _, ct) =>
            {
                await Task.Delay(30, ct);
                throw new HttpRequestException("Sarvam is unreachable");
            }),
            blob: new VsBlobStore(async (_, ct) => await Task.Delay(90, ct))); // slower than the failing speech-to-text

        var (result, jobId, _, _) = await rig.RunAsync("s4-stt-fails-1");

        Assert.False(result.Success);
        var job = await rig.JobAsync(jobId);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef), "the audio write must be allowed to finish when speech-to-text fails");
        Assert.Single(rig.Blob.Stored);
    }

    // =====================================================================================================
    // Cancelling cancels both
    // =====================================================================================================

    [Fact]
    public async Task Cancelling_the_token_cancels_both_the_write_and_speech_to_text()
    {
        var bothStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = 0;
        void MarkStarted()
        {
            if (Interlocked.Increment(ref started) == 2)
            {
                bothStarted.TrySetResult();
            }
        }

        var blobCancelled = false;
        var sttCancelled = false;
        var rig = VsRig.Create(
            blob: new VsBlobStore(async (_, ct) =>
            {
                MarkStarted();
                try
                {
                    await Task.Delay(Timeout.Infinite, ct);
                }
                catch (OperationCanceledException)
                {
                    blobCancelled = true;
                    throw;
                }
            }),
            transcriber: new VsTranscriber(async (_, _, ct) =>
            {
                MarkStarted();
                try
                {
                    await Task.Delay(Timeout.Infinite, ct);
                }
                catch (OperationCanceledException)
                {
                    sttCancelled = true;
                    throw;
                }

                return VsTranscriber.Words();
            }));
        using var cts = new CancellationTokenSource();

        var run = rig.RunAsync("s4-cancel-1", ct: cts.Token);
        var reached = await Task.WhenAny(bothStarted.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.Same(bothStarted.Task, reached); // both really were in flight before we cancelled
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run);
        Assert.True(blobCancelled, "the raw-audio write did not see the cancellation");
        Assert.True(sttCancelled, "speech-to-text did not see the cancellation");
    }

    // =====================================================================================================
    // AI processing switched off
    // =====================================================================================================

    [Fact]
    public async Task With_ai_processing_disabled_only_the_write_runs_and_the_transcriber_is_never_called()
    {
        var rig = VsRig.Create(config: VsConfig.SarvamSarvam(aiDisabled: true));

        var (result, jobId, _, _) = await rig.RunAsync("s4-disabled-1");

        Assert.False(result.Success);
        Assert.Equal(1, rig.Blob.PutCalls);
        Assert.Equal(0, rig.Transcriber!.Calls);
        Assert.Equal(0, rig.Sarvam.VoiceCalls);
        var job = await rig.JobAsync(jobId);
        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef)); // the audio is still kept
    }

    // =====================================================================================================
    // The job row comes last
    // =====================================================================================================

    [Fact]
    public async Task The_job_row_is_added_only_after_both_the_write_and_speech_to_text_have_finished()
    {
        var log = new VsLog();
        var rig = VsRig.Create(
            log: log,
            blob: new VsBlobStore(async (_, ct) => await Task.Delay(40, ct), log),
            transcriber: new VsTranscriber(async (_, _, ct) =>
            {
                await Task.Delay(180, ct); // the slower of the two
                return VsTranscriber.Words();
            }, log));

        var (result, _, _, _) = await rig.RunAsync("s4-order-1");

        Assert.True(result.Success, result.Error);
        var names = log.Names;
        var jobAdded = names.ToList().IndexOf("job-added");
        Assert.True(jobAdded >= 0, "no job row was added: " + string.Join(", ", names));
        Assert.True(jobAdded > log.IndexOf("put-end"), "the job row was added before the raw-audio write finished: " + string.Join(", ", names));
        Assert.True(jobAdded > log.IndexOf("stt-end"), "the job row was added before speech-to-text finished: " + string.Join(", ", names));
        Assert.Equal(1, names.Count(n => n == "job-added"));
    }

    [Fact]
    public async Task The_job_row_is_added_after_the_write_even_when_the_write_is_the_slower_stage()
    {
        var log = new VsLog();
        var rig = VsRig.Create(
            log: log,
            blob: new VsBlobStore(async (_, ct) => await Task.Delay(180, ct), log),
            transcriber: new VsTranscriber(async (_, _, ct) =>
            {
                await Task.Delay(30, ct);
                return VsTranscriber.Words();
            }, log));

        var (result, _, _, _) = await rig.RunAsync("s4-order-2");

        Assert.True(result.Success, result.Error);
        var jobAdded = log.IndexOf("job-added");
        Assert.True(jobAdded > log.IndexOf("put-end"), "the job row was added before the raw-audio write finished: " + string.Join(", ", log.Names));
        Assert.True(jobAdded > log.IndexOf("stt-end"), "the job row was added before speech-to-text finished: " + string.Join(", ", log.Names));
    }

    [Fact]
    public async Task The_transcriber_receives_the_same_bytes_the_blob_store_keeps()
    {
        byte[]? heard = null;
        var rig = VsRig.Create(transcriber: new VsTranscriber(async (audio, _, ct) =>
        {
            using var copy = new MemoryStream();
            await audio.CopyToAsync(copy, ct);
            heard = copy.ToArray();
            return VsTranscriber.Words();
        }));

        var (result, jobId, _, _) = await rig.RunAsync("s4-same-bytes-1");

        Assert.True(result.Success, result.Error);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, heard);
        var stored = Assert.Single(rig.Blob.Stored);
        Assert.Equal(ShramSafal.Domain.Storage.RawBlobRef.FromBytes(heard!, "audio/webm").Sha256, stored.Sha256);
        Assert.Equal(stored.Sha256, (await rig.JobAsync(jobId)).RawInputRef);
    }
}

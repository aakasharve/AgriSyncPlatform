// spec: voice-instant-phase-a-2026-11-23 (S6) and voice-india-only-sarvam (Task 3) - Sarvam transcribes AND Sarvam sorts.
//
// Authored from the acceptance criteria only. No AI is called: scripted fakes for the speech-to-text port, the providers
// and the raw-audio store (see VoiceSpeedTestKit). Gemini is a fake that answers CanHandle(voice) = false, the shipped
// state, unless a test says otherwise.
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class AiOrchestratorSarvamToSarvamTests
{
    // =====================================================================================================
    // (a) transcriber Sarvam + structurer Sarvam = the two-stage path, and Gemini is never called
    // =====================================================================================================

    [Fact]
    public async Task Sarvam_then_Sarvam_runs_Saaras_then_Sarvam_sorting_on_text_plain_and_never_calls_gemini()
    {
        // Gemini is even ALLOWED to take voice here, so "never called" is a choice the orchestrator made, not an accident.
        var rig = VsRig.Create(geminiTakesVoice: true);

        var (result, jobId, providerUsed, fallbackUsed) = await rig.RunAsync("s6-a-1");

        Assert.True(result.Success, result.Error);
        Assert.False(fallbackUsed);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        Assert.Equal(VoiceStageTimings.TwoStagePath, result.StageTimings!.Path);

        Assert.Equal(1, rig.Transcriber!.Calls);
        Assert.Equal("audio/webm", rig.Transcriber.LastMime);

        var sorted = Assert.Single(rig.Sarvam.Calls);
        Assert.Equal("text/plain", sorted.Mime);
        Assert.Equal(VsTranscriber.DefaultTranscript, sorted.Text); // what Saaras heard is what Sarvam sorts
        Assert.Equal(0, rig.Gemini.VoiceCalls);

        var job = await rig.JobAsync(jobId);
        Assert.Equal(AiJobStatus.Succeeded, job.Status);
        Assert.Equal("Sarvam", job.TranscriptProvider);
        Assert.Equal(VsTranscriber.DefaultTranscript, job.TranscriptCodemix);
        Assert.Equal("saaras:v4", job.TranscriptModelVersion);
        Assert.Equal("Sarvam", result.TranscriptProvider);
        Assert.Equal(VsTranscriber.DefaultTranscript, result.TranscriptCodemix);
        Assert.All(job.Attempts, a => Assert.Equal(AiProviderType.Sarvam, a.Provider));
    }

    [Fact]
    public async Task A_recording_that_was_split_into_six_pieces_still_completes_on_the_two_stage_path()
    {
        var rig = VsRig.Create(transcriber: new VsTranscriber((_, _, _) => Task.FromResult(VsTranscriber.Words("आज सहा तुकड्यांची नोंद.", pieces: 6))));

        var (result, jobId, _, fallbackUsed) = await rig.RunAsync("s6-a-6pieces");

        Assert.True(result.Success, result.Error);
        Assert.False(fallbackUsed);
        Assert.Equal(1, rig.Sarvam.VoiceCalls);
        Assert.Equal(0, rig.Gemini.VoiceCalls);
        Assert.Equal(AiJobStatus.Succeeded, (await rig.JobAsync(jobId)).Status);
    }

    // =====================================================================================================
    // (b) the one-call path: no transcriber port, or text
    // =====================================================================================================

    [Fact]
    public async Task With_no_transcriber_port_registered_the_one_call_path_runs_with_the_audio()
    {
        var rig = VsRig.Create(registerTranscriber: false);

        var (result, jobId, providerUsed, _) = await rig.RunAsync("s6-b-noport");

        Assert.True(result.Success, result.Error);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        var call = Assert.Single(rig.Sarvam.Calls);
        Assert.Equal("audio/webm", call.Mime); // the audio itself, not a transcript
        Assert.Equal(0, rig.Gemini.VoiceCalls);
        Assert.Equal(AiJobStatus.Succeeded, (await rig.JobAsync(jobId)).Status);
    }

    [Fact]
    public async Task A_transcriber_registered_for_another_provider_than_the_one_the_row_names_also_means_one_call()
    {
        // The row names Gemini as the transcriber; only a Sarvam port exists.
        var config = VsConfig.SarvamSarvam();
        config.SetProviderTuple("Gemini", "codemix", "Sarvam", null);
        var rig = VsRig.Create(config: config);

        var (result, _, _, _) = await rig.RunAsync("s6-b-otherport");

        Assert.True(result.Success, result.Error);
        Assert.Equal(0, rig.Transcriber!.Calls);
        var call = Assert.Single(rig.Sarvam.Calls);
        Assert.Equal("audio/webm", call.Mime);
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("text/plain; charset=utf-8")]
    [InlineData("text/markdown")]
    [InlineData("TEXT/PLAIN")]
    public async Task A_text_mime_type_goes_to_the_one_call_path_and_the_transcriber_is_not_asked(string mime)
    {
        var rig = VsRig.Create();

        var (result, _, _, _) = await rig.RunAsync("s6-b-text-" + Guid.NewGuid().ToString("N"), mime);

        Assert.True(result.Success, result.Error);
        Assert.Equal(0, rig.Transcriber!.Calls);
        var call = Assert.Single(rig.Sarvam.Calls);
        Assert.Equal(mime, call.Mime);
        Assert.Equal(0, rig.Gemini.VoiceCalls);
    }

    // =====================================================================================================
    // (d) nobody else can take voice: a failure ends the job as Failed, keeps the audio, and says "try again later"
    // =====================================================================================================

    private static void AssertKeptForRetry(VsRig rig, VoiceParseCanonicalResult result, AiJob job)
    {
        Assert.False(result.Success);
        Assert.True(result.Retryable, "the phone should be told to send this again later");
        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef), "the raw audio reference must be kept on the failed job");
        Assert.Equal(rig.Blob.Stored.Single().Sha256, job.RawInputRef);
        Assert.Equal(1, rig.Blob.PutCalls); // the audio was stored once, up front, and not again
        Assert.Equal(1, rig.Transcriber!.Calls); // speech-to-text was not run a second time
        Assert.Equal(0, rig.Gemini.VoiceCalls);
    }

    [Fact]
    public async Task A_transcriber_that_throws_ends_the_job_failed_with_the_audio_kept_retryable_and_no_second_sarvam_run()
    {
        var rig = VsRig.Create(transcriber: new VsTranscriber((_, _, _) => throw new HttpRequestException("Sarvam is unreachable")));

        var (result, jobId, _, fallbackUsed) = await rig.RunAsync("s6-d-throws");

        AssertKeptForRetry(rig, result, await rig.JobAsync(jobId));
        Assert.False(fallbackUsed);
        Assert.Equal(0, rig.Sarvam.VoiceCalls); // the one-call path (a second Sarvam run, billed again) never ran
        Assert.Equal(VoiceStageTimings.TwoStagePath, result.StageTimings!.Path);
    }

    [Theory]
    [InlineData("failure-no-code")]
    [InlineData("part-failed")]
    [InlineData("empty-transcript")]
    [InlineData("whitespace-transcript")]
    public async Task A_transcriber_that_returns_a_retryable_failure_or_no_words_ends_the_same_way(string kind)
    {
        TranscribeResult answer = kind switch
        {
            "failure-no-code" => new TranscribeResult { Success = false, Error = "timeout transient failure" },
            "part-failed" => new TranscribeResult
            {
                Success = false,
                Error = "Sarvam STT failed on part 2 of 3: HTTP 503",
                FailureCode = TranscribeFailureCodes.PartFailed,
                Pieces = 3,
            },
            "empty-transcript" => new TranscribeResult { Success = true, Transcript = string.Empty },
            "whitespace-transcript" => new TranscribeResult { Success = true, Transcript = "   " },
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var rig = VsRig.Create(transcriber: new VsTranscriber((_, _, _) => Task.FromResult(answer)));

        var (result, jobId, _, _) = await rig.RunAsync("s6-d-stt-" + kind);

        AssertKeptForRetry(rig, result, await rig.JobAsync(jobId));
        Assert.Equal(0, rig.Sarvam.VoiceCalls);
    }

    [Theory]
    [InlineData("failure-text")]
    [InlineData("exception")]
    public async Task A_structurer_failure_ends_the_job_failed_keeping_audio_and_transcript_retryable_and_no_second_sarvam_run(string kind)
    {
        var rig = VsRig.Create(sarvam: new VsProvider(AiProviderType.Sarvam, answer: (_, _) => kind == "exception"
            ? throw new HttpRequestException("Sarvam chat is unreachable")
            : Task.FromResult(VsProvider.Failed("timeout transient failure"))));

        var (result, jobId, providerUsed, fallbackUsed) = await rig.RunAsync("s6-d-struct-" + kind);

        var job = await rig.JobAsync(jobId);
        AssertKeptForRetry(rig, result, job);
        Assert.False(fallbackUsed);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        // The transcript is kept on the job and on the result, so a retry can start from the words.
        Assert.Equal(VsTranscriber.DefaultTranscript, job.TranscriptCodemix);
        Assert.Equal("Sarvam", job.TranscriptProvider);
        Assert.Equal(VsTranscriber.DefaultTranscript, result.TranscriptCodemix);
        // Sarvam sorting was tried for the words only (text/plain): the recording itself never went to Sarvam again.
        Assert.NotEmpty(rig.Sarvam.Calls);
        Assert.All(rig.Sarvam.Calls, c => Assert.Equal("text/plain", c.Mime));
    }

    [Fact]
    public async Task A_structurer_that_is_retried_by_the_row_is_retried_on_the_words_only()
    {
        var rig = VsRig.Create(
            config: VsConfig.SarvamSarvam(maxRetries: 2),
            sarvam: new VsProvider(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(VsProvider.Failed("timeout transient failure"))));

        var (result, jobId, _, _) = await rig.RunAsync("s6-d-struct-retries");

        AssertKeptForRetry(rig, result, await rig.JobAsync(jobId));
        Assert.Equal(2, rig.Sarvam.VoiceCalls); // exactly the two attempts the row allows
        Assert.All(rig.Sarvam.Calls, c => Assert.Equal("text/plain", c.Mime));
    }

    [Fact]
    public async Task The_same_recording_sent_again_after_a_retryable_failure_completes_on_the_same_job()
    {
        var attempt = 0;
        var rig = VsRig.Create(transcriber: new VsTranscriber((_, _, _) =>
            Interlocked.Increment(ref attempt) == 1
                ? throw new HttpRequestException("Sarvam is unreachable")
                : Task.FromResult(VsTranscriber.Words())));

        var first = await rig.RunAsync("s6-d-resend");
        Assert.False(first.Result.Success);
        Assert.True(first.Result.Retryable);

        var second = await rig.RunAsync("s6-d-resend");

        Assert.True(second.Result.Success, second.Result.Error);
        Assert.False(second.Result.Retryable);
        Assert.Equal(first.JobId, second.JobId); // one job per idempotency key, as ever
        var job = await rig.JobAsync(second.JobId);
        Assert.Equal(AiJobStatus.Succeeded, job.Status);
        Assert.Equal(VsTranscriber.DefaultTranscript, job.TranscriptCodemix);
        Assert.Equal(0, rig.Gemini.VoiceCalls);
        Assert.Equal(1, rig.Jobs.AddCalls); // the second request reused the stored job row
    }

    // ---- a failure that is NOT worth sending again stays a plain failure ----

    [Fact]
    public async Task A_recording_that_is_refused_for_good_is_not_retryable_but_its_audio_is_still_kept()
    {
        var rig = VsRig.Create(transcriber: new VsTranscriber((_, _, _) => Task.FromResult(new TranscribeResult
        {
            Success = false,
            Error = "Audio is longer than 15 minutes; it was not transcribed.",
            FailureCode = TranscribeFailureCodes.AudioTooLong,
            Pieces = 0,
        })));

        var (result, jobId, _, _) = await rig.RunAsync("s6-d-toolong");

        Assert.False(result.Success);
        Assert.False(result.Retryable, "sending a too-long recording again can never work");
        var job = await rig.JobAsync(jobId);
        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef));
        Assert.Equal(0, rig.Sarvam.VoiceCalls);
        Assert.Equal(0, rig.Gemini.VoiceCalls);
    }

    [Fact]
    public async Task A_structurer_that_refuses_the_input_is_not_retryable_and_never_runs_twice()
    {
        var rig = VsRig.Create(
            config: VsConfig.SarvamSarvam(maxRetries: 3),
            sarvam: new VsProvider(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(VsProvider.Failed("invalid input required field"))));

        var (result, jobId, _, _) = await rig.RunAsync("s6-d-userfault");

        Assert.False(result.Success);
        Assert.False(result.Retryable);
        var job = await rig.JobAsync(jobId);
        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.False(string.IsNullOrWhiteSpace(job.RawInputRef));
        Assert.Equal(VsTranscriber.DefaultTranscript, job.TranscriptCodemix);
        Assert.Equal(1, rig.Sarvam.VoiceCalls);
        Assert.Equal(0, rig.Gemini.VoiceCalls);
    }

    [Fact]
    public void The_voice_unavailable_error_carries_the_code_the_endpoint_answers_503_for()
    {
        Assert.Equal("ShramSafal.AiVoiceUnavailable", ShramSafal.Domain.Common.ShramSafalErrors.AiVoiceUnavailable.Code);
        Assert.False(string.IsNullOrWhiteSpace(ShramSafal.Domain.Common.ShramSafalErrors.AiVoiceUnavailable.Description));
        Assert.NotEqual(
            ShramSafal.Domain.Common.ShramSafalErrors.AiParsingFailed.Code,
            ShramSafal.Domain.Common.ShramSafalErrors.AiVoiceUnavailable.Code);
    }

    [Fact]
    public async Task A_success_is_never_flagged_retryable()
    {
        var rig = VsRig.Create();

        var (result, _, _, _) = await rig.RunAsync("s6-d-success");

        Assert.True(result.Success);
        Assert.False(result.Retryable);
    }

    // ---- when another provider CAN take voice, the earlier hand-over is unchanged ----

    [Fact]
    public async Task When_another_provider_can_take_voice_a_transcriber_failure_still_hands_the_recording_to_the_one_call_path()
    {
        var rig = VsRig.Create(
            geminiTakesVoice: true,
            transcriber: new VsTranscriber((_, _, _) => throw new HttpRequestException("Sarvam is unreachable")));

        var (result, _, _, _) = await rig.RunAsync("s6-d-others-can");

        // The one-call path ran: the recording itself (audio, not words) went to a provider.
        Assert.True(rig.Sarvam.Calls.Concat(rig.Gemini.Calls).Any(c => c.Mime == "audio/webm"), "the recording was not handed to the one-call path");
        Assert.False(result.Retryable);
    }

    // ---- a low-confidence answer when nobody else can take voice (CTO fix, 24 Nov 2026, test-writer finding) ----

    private static VsProvider SarvamAnsweringWithConfidence(decimal confidence) =>
        new(AiProviderType.Sarvam, answer: (_, _) => Task.FromResult(VsProvider.GoodAnswer() with { OverallConfidence = confidence }));

    [Fact]
    public async Task A_low_confidence_answer_with_no_other_voice_provider_is_kept_as_the_jobs_success_and_never_billed_twice()
    {
        var rig = VsRig.Create(sarvam: SarvamAnsweringWithConfidence(0.40m));

        var first = await rig.RunAsync("s6-lowconf-kept");

        Assert.True(first.Result.Success, first.Result.Error);
        Assert.Equal(0.40m, first.Result.OverallConfidence); // the low confidence travels with the answer, nothing is hidden
        Assert.False(first.Result.Retryable);
        var job = await rig.JobAsync(first.JobId);
        Assert.Equal(AiJobStatus.Succeeded, job.Status); // the job tells the same story the farmer was shown

        var again = await rig.RunAsync("s6-lowconf-kept");

        Assert.True(again.Result.Success, again.Result.Error);
        Assert.Equal(first.JobId, again.JobId);
        Assert.Equal(1, rig.Transcriber!.Calls); // the stored answer came back: no second speech-to-text
        Assert.Equal(1, rig.Sarvam.VoiceCalls); // no second sorting
        Assert.Equal(1, rig.Blob.PutCalls); // no second audio write
        Assert.Equal(0, rig.Gemini.VoiceCalls);
    }

    [Fact]
    public async Task Many_low_confidence_notes_in_a_row_never_switch_voice_off_for_everyone()
    {
        // A breaker that opens after five failures, like the shipped row. Low confidence is not a provider failure.
        var config = AiProviderConfig.CreateDefault();
        config.UpdateSettings(
            modifiedByUserId: Guid.NewGuid(),
            defaultProvider: AiProviderType.Sarvam,
            fallbackEnabled: true,
            isAiProcessingDisabled: false,
            maxRetries: 1,
            circuitBreakerThreshold: 5,
            circuitBreakerResetSeconds: 60,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m,
            voiceProvider: AiProviderType.Sarvam,
            receiptProvider: AiProviderType.Gemini,
            pattiProvider: AiProviderType.Gemini);
        config.SetProviderTuple("Sarvam", "codemix", "Sarvam", null);
        var rig = VsRig.Create(config: config, sarvam: SarvamAnsweringWithConfidence(0.40m));

        for (var i = 0; i < 8; i++)
        {
            var (result, _, _, _) = await rig.RunAsync($"s6-lowconf-row-{i}");
            Assert.True(result.Success, $"note {i}: {result.Error}");
        }

        Assert.Equal(8, rig.Sarvam.VoiceCalls); // every note reached Sarvam: the breaker never opened
    }

    [Fact]
    public async Task When_another_provider_can_take_voice_a_low_confidence_answer_is_still_handed_to_it()
    {
        var rig = VsRig.Create(geminiTakesVoice: true, sarvam: SarvamAnsweringWithConfidence(0.40m));

        var (result, _, providerUsed, fallbackUsed) = await rig.RunAsync("s6-lowconf-others-can");

        Assert.True(result.Success, result.Error);
        Assert.True(fallbackUsed);
        Assert.Equal(AiProviderType.Gemini, providerUsed);
        Assert.True(rig.Gemini.VoiceCalls >= 1);
    }
}

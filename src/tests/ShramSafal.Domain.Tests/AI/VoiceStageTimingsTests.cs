// spec: voice-instant-phase-a-2026-11-23 (Task 0, server half) - where the server's time goes, measured per stage.
//
// Authored from the acceptance criteria only. No AI is called: fakes for the raw-audio store, the speech-to-text port and
// the providers (see VoiceSpeedTestKit).
using System.Globalization;
using System.Text.RegularExpressions;
using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class VoiceStageTimingsTests
{
    private static readonly Regex HeaderShape = new(
        "^s3;dur=[0-9]+, stt;dur=[0-9]+, struct;dur=[0-9]+, total;dur=[0-9]+$",
        RegexOptions.CultureInvariant);

    // =====================================================================================================
    // The Server-Timing value
    // =====================================================================================================

    [Fact]
    public void The_header_names_the_four_stages_in_order_in_whole_milliseconds()
    {
        var header = new VoiceStageTimings(120, 2400, 3100, 5800, VoiceStageTimings.TwoStagePath).ToServerTimingHeader();

        Assert.Equal("s3;dur=120, stt;dur=2400, struct;dur=3100, total;dur=5800", header);
    }

    [Theory]
    [InlineData(0, 0, 0, 0, "s3;dur=0, stt;dur=0, struct;dur=0, total;dur=0")]
    [InlineData(1, 2, 3, 4, "s3;dur=1, stt;dur=2, struct;dur=3, total;dur=4")]
    [InlineData(int.MaxValue, int.MaxValue, int.MaxValue, int.MaxValue,
        "s3;dur=2147483647, stt;dur=2147483647, struct;dur=2147483647, total;dur=2147483647")]
    public void Whole_numbers_at_the_edges_are_written_as_they_are(int s3, int stt, int structure, int total, string expected)
    {
        Assert.Equal(expected, new VoiceStageTimings(s3, stt, structure, total, VoiceStageTimings.TwoStagePath).ToServerTimingHeader());
    }

    [Theory]
    [InlineData(-1, 5, 6, 7, "s3;dur=0, stt;dur=5, struct;dur=6, total;dur=7")]
    [InlineData(5, -1, 6, 7, "s3;dur=5, stt;dur=0, struct;dur=6, total;dur=7")]
    [InlineData(5, 6, -1, 7, "s3;dur=5, stt;dur=6, struct;dur=0, total;dur=7")]
    [InlineData(5, 6, 7, -1, "s3;dur=5, stt;dur=6, struct;dur=7, total;dur=0")]
    [InlineData(int.MinValue, int.MinValue, int.MinValue, int.MinValue, "s3;dur=0, stt;dur=0, struct;dur=0, total;dur=0")]
    public void A_negative_value_is_never_written(int s3, int stt, int structure, int total, string expected)
    {
        var header = new VoiceStageTimings(s3, stt, structure, total, VoiceStageTimings.TwoStagePath).ToServerTimingHeader();

        Assert.Equal(expected, header);
        Assert.DoesNotContain("-", header, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("fr-FR")]
    [InlineData("ar-SA")]
    [InlineData("mr-IN")]
    [InlineData("hi-IN")]
    public void The_header_is_the_same_in_every_culture_plain_digits_no_separators(string culture)
    {
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(culture);

            var header = new VoiceStageTimings(1234567, 7654321, 1000, 2000000, VoiceStageTimings.TwoStagePath).ToServerTimingHeader();

            Assert.Equal("s3;dur=1234567, stt;dur=7654321, struct;dur=1000, total;dur=2000000", header);
            Assert.Matches(HeaderShape, header);
        }
        finally
        {
            CultureInfo.CurrentCulture = before;
        }
    }

    [Fact]
    public void The_three_path_names_are_distinct_and_the_two_the_phone_reads_are_fixed_words()
    {
        Assert.Equal("two-stage", VoiceStageTimings.TwoStagePath);
        Assert.Equal("one-call", VoiceStageTimings.OneCallPath);
        Assert.Equal(3, new[] { VoiceStageTimings.TwoStagePath, VoiceStageTimings.OneCallPath, VoiceStageTimings.CachedPath }.Distinct().Count());
    }

    // =====================================================================================================
    // The orchestrator fills them in
    // =====================================================================================================

    [Fact]
    public async Task A_two_stage_parse_returns_its_stage_times_on_the_result_with_the_two_stage_path()
    {
        var rig = VsRig.Create(
            transcriber: new VsTranscriber(async (_, _, ct) =>
            {
                await Task.Delay(90, ct);
                return VsTranscriber.Words();
            }),
            blob: new VsBlobStore(async (_, ct) => await Task.Delay(70, ct)),
            sarvam: new VsProvider(AiProviderType.Sarvam, answer: async (_, ct) =>
            {
                await Task.Delay(50, ct);
                return VsProvider.GoodAnswer();
            }));

        var (result, _, _, _) = await rig.RunAsync("timings-two-stage-1");

        Assert.True(result.Success, result.Error);
        var timings = result.StageTimings;
        Assert.NotNull(timings);
        Assert.Equal(VoiceStageTimings.TwoStagePath, timings!.Path);

        // Each stage waited at least (about) its fake's delay; timers may fire a hair early, so the bounds are loose.
        Assert.InRange(timings.S3Ms, 50, 5000);
        Assert.InRange(timings.SttMs, 70, 5000);
        Assert.InRange(timings.StructMs, 30, 5000);

        // The whole call contains every stage, and speech-to-text and sorting ran one after the other inside it.
        Assert.True(timings.TotalMs >= timings.S3Ms, $"total {timings.TotalMs} < s3 {timings.S3Ms}");
        Assert.True(timings.TotalMs >= timings.SttMs, $"total {timings.TotalMs} < stt {timings.SttMs}");
        Assert.True(timings.TotalMs >= timings.StructMs, $"total {timings.TotalMs} < struct {timings.StructMs}");
        Assert.True(timings.TotalMs + 2 >= timings.SttMs + timings.StructMs, $"total {timings.TotalMs} < stt {timings.SttMs} + struct {timings.StructMs}");
    }

    [Fact]
    public async Task The_header_built_from_a_real_parse_is_well_formed()
    {
        var rig = VsRig.Create();

        var (result, _, _, _) = await rig.RunAsync("timings-header-1");

        Assert.NotNull(result.StageTimings);
        Assert.Matches(HeaderShape, result.StageTimings!.ToServerTimingHeader());
        Assert.True(result.StageTimings.S3Ms >= 0 && result.StageTimings.SttMs >= 0 && result.StageTimings.StructMs >= 0 && result.StageTimings.TotalMs >= 0);
    }

    [Fact]
    public async Task A_repeated_request_answered_from_the_stored_job_reports_the_cached_path_and_runs_no_stage()
    {
        var rig = VsRig.Create();
        var first = await rig.RunAsync("timings-cached-1");
        Assert.True(first.Result.Success, first.Result.Error);
        Assert.Equal(VoiceStageTimings.TwoStagePath, first.Result.StageTimings!.Path);
        var putsAfterFirst = rig.Blob.PutCalls;
        var transcribeAfterFirst = rig.Transcriber!.Calls;
        var structureAfterFirst = rig.Sarvam.VoiceCalls;

        var second = await rig.RunAsync("timings-cached-1");

        Assert.True(second.Result.Success);
        Assert.Equal(first.JobId, second.JobId);
        Assert.NotNull(second.Result.StageTimings);
        Assert.Equal(VoiceStageTimings.CachedPath, second.Result.StageTimings!.Path);
        Assert.Equal(0, second.Result.StageTimings.S3Ms);
        Assert.Equal(0, second.Result.StageTimings.SttMs);
        Assert.Equal(0, second.Result.StageTimings.StructMs);
        Assert.True(second.Result.StageTimings.TotalMs >= 0);
        // Nothing ran again.
        Assert.Equal(putsAfterFirst, rig.Blob.PutCalls);
        Assert.Equal(transcribeAfterFirst, rig.Transcriber.Calls);
        Assert.Equal(structureAfterFirst, rig.Sarvam.VoiceCalls);
    }

    [Fact]
    public async Task With_no_transcriber_registered_the_one_call_path_reports_one_call_and_times_no_speech_or_sorting_stage()
    {
        var rig = VsRig.Create(registerTranscriber: false);

        var (result, _, providerUsed, _) = await rig.RunAsync("timings-one-call-1");

        Assert.True(result.Success, result.Error);
        Assert.Equal(AiProviderType.Sarvam, providerUsed);
        Assert.NotNull(result.StageTimings);
        Assert.Equal(VoiceStageTimings.OneCallPath, result.StageTimings!.Path);
        // One provider call does speech-to-text and sorting together: they are not timed apart, and a stage that did not
        // run reads 0, never a guess.
        Assert.Equal(0, result.StageTimings.SttMs);
        Assert.Equal(0, result.StageTimings.StructMs);
        Assert.True(result.StageTimings.TotalMs >= 0);
    }

    [Fact]
    public async Task Typed_text_goes_to_the_one_call_path_and_the_transcriber_is_never_asked()
    {
        var rig = VsRig.Create();

        var (result, _, _, _) = await rig.RunAsync("timings-text-1", mime: "text/plain");

        Assert.True(result.Success, result.Error);
        Assert.Equal(0, rig.Transcriber!.Calls);
        Assert.Equal(VoiceStageTimings.OneCallPath, result.StageTimings!.Path);
    }

    [Fact]
    public async Task A_failed_two_stage_parse_carries_its_timings_too()
    {
        var rig = VsRig.Create(transcriber: new VsTranscriber((_, _, _) => throw new InvalidOperationException("Sarvam is down")));

        var (result, _, _, _) = await rig.RunAsync("timings-failed-1");

        Assert.False(result.Success);
        Assert.NotNull(result.StageTimings);
        Assert.Equal(VoiceStageTimings.TwoStagePath, result.StageTimings!.Path);
        Assert.True(result.StageTimings.TotalMs >= 0);
        Assert.Matches(HeaderShape, result.StageTimings.ToServerTimingHeader());
    }

    [Fact]
    public async Task A_disabled_ai_parse_still_reports_timings()
    {
        var rig = VsRig.Create(config: VsConfig.SarvamSarvam(aiDisabled: true));

        var (result, _, _, _) = await rig.RunAsync("timings-disabled-1");

        Assert.False(result.Success);
        Assert.NotNull(result.StageTimings);
        Assert.Equal(0, result.StageTimings!.SttMs); // speech-to-text never started
        Assert.Equal(0, result.StageTimings.StructMs);
        Assert.Matches(HeaderShape, result.StageTimings.ToServerTimingHeader());
    }
}

using ShramSafal.Domain.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class AiJobTests
{
    [Fact]
    public void Create_SetsQueuedStatus()
    {
        var job = CreateJob("idem-create-1");

        Assert.Equal(AiJobStatus.Queued, job.Status);
        Assert.Equal(0, job.TotalAttempts);
        Assert.Null(job.CompletedAtUtc);
    }

    [Fact]
    public void AddAttempt_IncrementsTotalAttempts()
    {
        var job = CreateJob("idem-attempt-1");

        var attempt = job.AddAttempt(AiProviderType.Sarvam);

        Assert.Equal(1, job.TotalAttempts);
        Assert.Equal(AiJobStatus.Running, job.Status);
        Assert.Equal(1, attempt.AttemptNumber);
    }

    [Fact]
    public void MarkSucceeded_SetsStatusAndCompletionTime()
    {
        var job = CreateJob("idem-success-1");
        var attempt = job.AddAttempt(AiProviderType.Sarvam);
        attempt.RecordSuccess("{}", 100, null, 0.91m);

        job.MarkSucceeded("{\"summary\":\"done\"}", attempt);

        Assert.Equal(AiJobStatus.Succeeded, job.Status);
        Assert.NotNull(job.CompletedAtUtc);
        Assert.Equal("{\"summary\":\"done\"}", job.NormalizedResultJson);
    }

    [Fact]
    public void MarkFallbackSucceeded_SetsFallbackStatus()
    {
        var job = CreateJob("idem-fallback-1");
        var primary = job.AddAttempt(AiProviderType.Sarvam);
        primary.RecordFailure(AiFailureClass.TransientFailure, "timeout", null, 200);
        var fallback = job.AddAttempt(AiProviderType.Gemini);
        fallback.RecordSuccess("{}", 120, null, 0.84m);

        job.MarkFallbackSucceeded("{\"summary\":\"fallback\"}", fallback);

        Assert.Equal(AiJobStatus.FallbackSucceeded, job.Status);
        Assert.NotNull(job.CompletedAtUtc);
        Assert.Equal("{\"summary\":\"fallback\"}", job.NormalizedResultJson);
    }

    [Fact]
    public void MarkFailed_SetsFailedStatus()
    {
        var job = CreateJob("idem-failed-1");
        job.AddAttempt(AiProviderType.Sarvam);

        job.MarkFailed();

        Assert.Equal(AiJobStatus.Failed, job.Status);
        Assert.NotNull(job.CompletedAtUtc);
    }

    [Fact]
    public void Create_RejectsDuplicateIdempotencyKeysAcrossJobs()
    {
        const string idempotencyKey = "idem-unique-1";
        var first = CreateJob(idempotencyKey);
        var second = CreateJob(idempotencyKey);

        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(first.IdempotencyKey, second.IdempotencyKey);
        Assert.NotSame(first, second);
    }

    private static AiJob CreateJob(string idempotencyKey)
    {
        return AiJob.Create(
            Guid.NewGuid(),
            idempotencyKey,
            AiOperationType.VoiceToStructuredLog,
            Guid.NewGuid(),
            Guid.NewGuid(),
            inputContentHash: null,
            inputStoragePath: null);
    }
}

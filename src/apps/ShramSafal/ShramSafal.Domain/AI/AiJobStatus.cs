namespace ShramSafal.Domain.AI;

public enum AiJobStatus
{
    Queued = 0,
    Running = 1,
    Succeeded = 2,
    Failed = 3,
    FallbackSucceeded = 4
}

namespace ShramSafal.Domain.Logs;

public enum ExecutionStatus
{
    Completed = 0,  // default — back-compat for all existing logs
    Partial = 1,
    Skipped = 2,
    Delayed = 3,
    Modified = 4
}

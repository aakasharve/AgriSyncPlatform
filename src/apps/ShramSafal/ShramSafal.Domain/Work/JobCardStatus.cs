namespace ShramSafal.Domain.Work;

public enum JobCardStatus
{
    Draft = 0,               // created by owner/mukadam, not yet assigned
    Assigned = 1,            // assigned to a worker
    InProgress = 2,          // worker has started
    Completed = 3,           // worker / mukadam marked done (linked DailyLog may or may not be verified yet)
    VerifiedForPayout = 4,   // DailyLog.CurrentVerificationStatus = Verified → CEI-I9 allows payout
    PaidOut = 5,             // CostEntry(labour_payout, JobCardId=this.Id) exists → CEI-I8 holds
    Cancelled = 6            // terminal; no payout
}

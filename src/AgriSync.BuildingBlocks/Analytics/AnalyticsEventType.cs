namespace AgriSync.BuildingBlocks.Analytics;

public static class AnalyticsEventType
{
    public const string UserRegistered = "user.registered";
    public const string UserLoggedIn = "user.logged_in";
    public const string OtpSent = "otp.sent";
    public const string OtpVerified = "otp.verified";
    public const string OtpFailed = "otp.failed";

    public const string FarmCreated = "farm.created";
    public const string PlotCreated = "plot.created";
    public const string InvitationIssued = "invitation.issued";
    public const string InvitationClaimed = "invitation.claimed";
    public const string MembershipRevoked = "membership.revoked";

    public const string LogCreated = "log.created";
    public const string LogVerified = "log.verified";
    public const string LogCorrected = "log.corrected";
    public const string LogDisputed = "log.disputed";
    public const string BatchVerified = "batch.verified";

    public const string ScheduleAdopted = "schedule.adopted";
    public const string ScheduleMigrated = "schedule.migrated";
    public const string ScheduleAbandoned = "schedule.abandoned";
    public const string ScheduleCompleted = "schedule.completed";
    public const string SchedulePromptDismissed = "schedule.prompt_dismissed";

    public const string CostEntryAdded = "cost.entry.added";
    public const string CostEntryCorrected = "cost.entry.corrected";
    public const string GlobalExpenseAllocated = "finance.expense.allocated";

    public const string SubscriptionStartedTrial = "subscription.trial_started";
    public const string SubscriptionActivated = "subscription.activated";
    public const string SubscriptionRenewed = "subscription.renewed";
    public const string SubscriptionPastDue = "subscription.past_due";
    public const string SubscriptionExpired = "subscription.expired";
    public const string SubscriptionCancelled = "subscription.cancelled";

    public const string ReferralCodeIssued = "referral.code_issued";
    public const string ReferralMatched = "referral.matched";
    public const string BenefitLedgerEntry = "benefit.ledger_entry";
    public const string BenefitRedeemed = "benefit.redeemed";

    public const string AiInvocation = "ai.invocation";
    public const string SyncPushed = "sync.pushed";
    public const string SyncPullCompleted = "sync.pull_completed";
    public const string SyncConflict = "sync.conflict";
}

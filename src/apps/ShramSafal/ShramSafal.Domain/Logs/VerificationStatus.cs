namespace ShramSafal.Domain.Logs;

public enum VerificationStatus
{
    Draft = 0,
    Confirmed = 1,
    Verified = 2,
    Disputed = 3,
    CorrectionPending = 4,

    // Backward compatibility for legacy persisted enum strings.
    Approved = Verified,
    Rejected = Disputed
}

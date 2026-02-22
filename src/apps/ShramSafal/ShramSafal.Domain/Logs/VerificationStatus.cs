namespace ShramSafal.Domain.Logs;

public enum VerificationStatus
{
    Draft = 0,
    Approved = 1,
    Rejected = 2
}

    // Backward compatibility for legacy persisted enum strings.
    Approved = Verified,
    Rejected = Disputed
}

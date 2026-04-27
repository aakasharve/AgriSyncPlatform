namespace ShramSafal.Domain.Farms;

public enum GeoValidationStatus
{
    Unchecked = 0,
    Verified = 1,
    SelfDeclared = 2,
    Misaligned = 3,
    PartiallyMatched = 4,
    GovtRecordUnavailable = 5,
    ManualOverride = 6
}


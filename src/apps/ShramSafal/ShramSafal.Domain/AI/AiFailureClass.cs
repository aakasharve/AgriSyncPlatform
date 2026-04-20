namespace ShramSafal.Domain.AI;

public enum AiFailureClass
{
    None = 0,
    TransientFailure = 1,
    ProviderRateLimit = 2,
    ParseFailure = 3,
    SchemaInvalid = 4,
    LowConfidence = 5,
    UnsupportedInput = 6,
    UserError = 7
}

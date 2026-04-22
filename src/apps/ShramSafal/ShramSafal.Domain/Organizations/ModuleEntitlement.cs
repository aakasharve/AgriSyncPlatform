namespace ShramSafal.Domain.Organizations;

public sealed record ModuleEntitlement(
    string ModuleKey,
    bool CanRead,
    bool CanExport,
    bool CanWrite);

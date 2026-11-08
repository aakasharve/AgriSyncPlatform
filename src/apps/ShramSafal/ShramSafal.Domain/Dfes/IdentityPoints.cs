// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 3)
namespace ShramSafal.Domain.Dfes;

/// <summary>How many products earned each point reason on one day.</summary>
public readonly record struct IdentityPoints(int ProductConfirmed, int EvidenceMatch, int GapFilledLater)
{
    public static IdentityPoints None => default;

    public bool IsNone => ProductConfirmed == 0 && EvidenceMatch == 0 && GapFilledLater == 0;

    public int Total(ShramPointValues values) =>
        (ProductConfirmed * values.ProductConfirmed) + (EvidenceMatch * values.EvidenceMatch) + (GapFilledLater * values.GapFilledLater);
}

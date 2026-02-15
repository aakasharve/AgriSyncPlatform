namespace AgriSync.BuildingBlocks.Money;

public sealed record Currency
{
    public static readonly Currency Inr = new("INR");

    public Currency(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new ArgumentException("Currency code is required.", nameof(code));
        }

        Code = code.Trim().ToUpperInvariant();
    }

    public string Code { get; }
}

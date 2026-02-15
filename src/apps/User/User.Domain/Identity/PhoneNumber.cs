using AgriSync.BuildingBlocks.Domain;

namespace User.Domain.Identity;

public sealed class PhoneNumber : ValueObject
{
    private PhoneNumber(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static PhoneNumber Create(string raw)
    {
        var digits = new string(raw.Where(char.IsDigit).ToArray());

        if (digits.Length < 10 || digits.Length > 12)
        {
            throw new ArgumentException($"Phone number must be 10-12 digits, got {digits.Length}.", nameof(raw));
        }

        // Normalize Indian numbers: strip leading 91 country code if present
        if (digits.Length == 12 && digits.StartsWith("91"))
        {
            digits = digits[2..];
        }

        return new PhoneNumber(digits);
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Value;
    }

    public override string ToString() => Value;
}

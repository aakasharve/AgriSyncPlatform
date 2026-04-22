namespace ShramSafal.Domain.Organizations;

public sealed record FieldRedactionPolicy(
    IReadOnlyDictionary<string, FieldAccess> ByField)
{
    public FieldAccess For(string fieldName)
        => ByField.TryGetValue(fieldName, out var a) ? a : FieldAccess.Full;

    public static FieldRedactionPolicy Empty { get; }
        = new(new Dictionary<string, FieldAccess>());
}

namespace ShramSafal.Infrastructure.Storage;

public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    public string DataDirectory { get; set; } = "./data";

    public int MaxFileSizeMB { get; set; } = 25;
}

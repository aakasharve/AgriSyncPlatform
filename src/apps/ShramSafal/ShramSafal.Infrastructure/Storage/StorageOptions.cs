namespace ShramSafal.Infrastructure.Storage;

public sealed class StorageOptions
{
    public string DataDirectory { get; set; } = "App_Data";
    public string Provider { get; set; } = "Local";
    public string BucketName { get; set; } = string.Empty;
    public string Region { get; set; } = "ap-south-1";
    public string KeyPrefix { get; set; } = "attachments/";
}

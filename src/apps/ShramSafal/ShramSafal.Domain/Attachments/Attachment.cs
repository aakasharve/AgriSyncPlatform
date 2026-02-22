using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Attachments;

public sealed class Attachment : Entity<Guid>
{
    private Attachment() : base(Guid.Empty) { } // EF Core

    private Attachment(
        Guid id,
        FarmId farmId,
        Guid linkedEntityId,
        string linkedEntityType,
        string fileName,
        string mimeType,
        UserId createdByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        LinkedEntityId = linkedEntityId;
        LinkedEntityType = linkedEntityType;
        FileName = fileName;
        MimeType = mimeType;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        Status = AttachmentStatus.Pending;
    }

    public FarmId FarmId { get; private set; }
    public Guid LinkedEntityId { get; private set; }
    public string LinkedEntityType { get; private set; } = string.Empty;
    public string FileName { get; private set; } = string.Empty;
    public string MimeType { get; private set; } = string.Empty;
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public AttachmentStatus Status { get; private set; }
    public string? LocalPath { get; private set; }
    public long? SizeBytes { get; private set; }
    public DateTime? UploadedAtUtc { get; private set; }
    public DateTime? FinalizedAtUtc { get; private set; }

    public static Attachment Create(
        Guid id,
        FarmId farmId,
        Guid linkedEntityId,
        string linkedEntityType,
        string fileName,
        string mimeType,
        UserId createdByUserId,
        DateTime createdAtUtc)
    {
        if (linkedEntityId == Guid.Empty)
        {
            throw new ArgumentException("Linked entity id is required.", nameof(linkedEntityId));
        }

        if (string.IsNullOrWhiteSpace(linkedEntityType))
        {
            throw new ArgumentException("Linked entity type is required.", nameof(linkedEntityType));
        }

        if (string.IsNullOrWhiteSpace(fileName))
        {
            throw new ArgumentException("File name is required.", nameof(fileName));
        }

        if (string.IsNullOrWhiteSpace(mimeType))
        {
            throw new ArgumentException("Mime type is required.", nameof(mimeType));
        }

        return new Attachment(
            id,
            farmId,
            linkedEntityId,
            linkedEntityType.Trim(),
            fileName.Trim(),
            mimeType.Trim().ToLowerInvariant(),
            createdByUserId,
            createdAtUtc);
    }

    public void MarkUploaded(string localPath, long sizeBytes, DateTime uploadedAtUtc)
    {
        EnsureMutable();

        if (Status != AttachmentStatus.Pending)
        {
            throw new InvalidOperationException("Attachment can only be uploaded from Pending state.");
        }

        if (string.IsNullOrWhiteSpace(localPath))
        {
            throw new ArgumentException("Local path is required.", nameof(localPath));
        }

        if (sizeBytes <= 0)
        {
            throw new ArgumentException("Size must be greater than zero.", nameof(sizeBytes));
        }

        LocalPath = localPath.Trim();
        SizeBytes = sizeBytes;
        UploadedAtUtc = uploadedAtUtc;
        ModifiedAtUtc = uploadedAtUtc;
        Status = AttachmentStatus.Uploaded;
    }

    public void FinalizeUpload(DateTime finalizedAtUtc)
    {
        EnsureMutable();

        if (Status != AttachmentStatus.Uploaded)
        {
            throw new InvalidOperationException("Attachment must be uploaded before finalization.");
        }

        FinalizedAtUtc = finalizedAtUtc;
        ModifiedAtUtc = finalizedAtUtc;
        Status = AttachmentStatus.Finalized;
    }

    private void EnsureMutable()
    {
        if (Status == AttachmentStatus.Finalized)
        {
            throw new InvalidOperationException("Attachment is immutable after finalization.");
        }
    }
}

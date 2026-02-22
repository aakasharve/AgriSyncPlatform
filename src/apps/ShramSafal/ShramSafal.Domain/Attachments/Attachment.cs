using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Attachments;

public sealed class Attachment : Entity<Guid>
{
    private Attachment() : base(Guid.Empty) { } // EF Core

    private Attachment(
        Guid id,
        FarmId farmId,
        UserId uploadedByUserId,
        string originalFileName,
        string mimeType,
        long sizeBytes,
        string storagePath,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        UploadedByUserId = uploadedByUserId;
        OriginalFileName = originalFileName;
        MimeType = mimeType;
        SizeBytes = sizeBytes;
        StoragePath = storagePath;
        CreatedAtUtc = createdAtUtc;
        Status = AttachmentStatus.Pending;
    }

    public FarmId FarmId { get; private set; }
    public Guid? LinkedEntityId { get; private set; }
    public string? LinkedEntityType { get; private set; }
    public UserId UploadedByUserId { get; private set; }
    public string OriginalFileName { get; private set; } = string.Empty;
    public string MimeType { get; private set; } = string.Empty;
    public long SizeBytes { get; private set; }
    public string StoragePath { get; private set; } = string.Empty;
    public AttachmentStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? FinalizedAtUtc { get; private set; }

    public static Attachment Create(
        Guid id,
        Guid farmId,
        Guid uploadedByUserId,
        string originalFileName,
        string mimeType,
        long sizeBytes,
        string storagePath,
        DateTime? createdAtUtc = null)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Attachment id is required.", nameof(id));
        }

        if (farmId == Guid.Empty)
        {
            throw new ArgumentException("Farm id is required.", nameof(farmId));
        }

        if (uploadedByUserId == Guid.Empty)
        {
            throw new ArgumentException("Uploaded by user id is required.", nameof(uploadedByUserId));
        }

        if (string.IsNullOrWhiteSpace(originalFileName))
        {
            throw new ArgumentException("Original file name is required.", nameof(originalFileName));
        }

        if (string.IsNullOrWhiteSpace(mimeType))
        {
            throw new ArgumentException("Mime type is required.", nameof(mimeType));
        }

        if (sizeBytes <= 0)
        {
            throw new ArgumentException("Attachment size must be greater than zero.", nameof(sizeBytes));
        }

        if (string.IsNullOrWhiteSpace(storagePath))
        {
            throw new ArgumentException("Storage path is required.", nameof(storagePath));
        }

        return new Attachment(
            id,
            new FarmId(farmId),
            new UserId(uploadedByUserId),
            originalFileName.Trim(),
            mimeType.Trim(),
            sizeBytes,
            storagePath.Trim(),
            createdAtUtc ?? DateTime.UtcNow);
    }

    public void MarkUploading()
    {
        if (Status == AttachmentStatus.Finalized)
        {
            throw new InvalidOperationException("Finalized attachments are immutable.");
        }

        Status = AttachmentStatus.Uploading;
    }

    public void SetStoragePath(string storagePath)
    {
        if (Status == AttachmentStatus.Finalized)
        {
            throw new InvalidOperationException("Finalized attachments are immutable.");
        }

        if (string.IsNullOrWhiteSpace(storagePath))
        {
            throw new ArgumentException("Storage path is required.", nameof(storagePath));
        }

        StoragePath = storagePath.Trim();
    }

    public void MarkFailed()
    {
        if (Status == AttachmentStatus.Finalized)
        {
            throw new InvalidOperationException("Finalized attachments are immutable.");
        }

        Status = AttachmentStatus.Failed;
    }

    public void FinalizeUpload(DateTime finalizedAtUtc)
    {
        if (Status == AttachmentStatus.Finalized)
        {
            return;
        }

        Status = AttachmentStatus.Finalized;
        FinalizedAtUtc = finalizedAtUtc.Kind == DateTimeKind.Utc
            ? finalizedAtUtc
            : finalizedAtUtc.ToUniversalTime();
    }

    public void LinkToEntity(Guid entityId, string entityType)
    {
        if (Status == AttachmentStatus.Finalized)
        {
            throw new InvalidOperationException("Finalized attachments are immutable.");
        }

        if (entityId == Guid.Empty)
        {
            throw new ArgumentException("Linked entity id is required.", nameof(entityId));
        }

        if (string.IsNullOrWhiteSpace(entityType))
        {
            throw new ArgumentException("Linked entity type is required.", nameof(entityType));
        }

        LinkedEntityId = entityId;
        LinkedEntityType = entityType.Trim();
    }
}

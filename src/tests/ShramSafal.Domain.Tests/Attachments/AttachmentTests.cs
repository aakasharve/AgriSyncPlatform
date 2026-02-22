using ShramSafal.Domain.Attachments;
using Xunit;

namespace ShramSafal.Domain.Tests.Attachments;

public sealed class AttachmentTests
{
    [Fact]
    public void CreateAttachment_SetsPendingStatus()
    {
        var attachment = CreateAttachment();

        Assert.Equal(AttachmentStatus.Pending, attachment.Status);
        Assert.Null(attachment.FinalizedAtUtc);
    }

    [Fact]
    public void FinalizeAttachment_SetsFinalizedStatusAndTimestamp()
    {
        var attachment = CreateAttachment();
        var finalizedAtUtc = DateTime.UtcNow;

        attachment.FinalizeUpload(finalizedAtUtc);

        Assert.Equal(AttachmentStatus.Finalized, attachment.Status);
        Assert.NotNull(attachment.FinalizedAtUtc);
        Assert.Equal(finalizedAtUtc, attachment.FinalizedAtUtc);
    }

    [Fact]
    public void LinkToEntity_SetsLinkedEntityFields()
    {
        var attachment = CreateAttachment();
        var linkedEntityId = Guid.NewGuid();

        attachment.LinkToEntity(linkedEntityId, "DailyLog");

        Assert.Equal(linkedEntityId, attachment.LinkedEntityId);
        Assert.Equal("DailyLog", attachment.LinkedEntityType);
    }

    [Fact]
    public void CannotModifyFinalizedAttachment()
    {
        var attachment = CreateAttachment();
        attachment.FinalizeUpload(DateTime.UtcNow);

        Assert.Throws<InvalidOperationException>(() => attachment.LinkToEntity(Guid.NewGuid(), "DailyLog"));
        Assert.Throws<InvalidOperationException>(() => attachment.SetStoragePath("attachments/farm/new-path.jpg"));
    }

    private static Attachment CreateAttachment()
    {
        return Attachment.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "receipt.jpg",
            "image/jpeg",
            1536,
            $"attachments/{Guid.NewGuid()}/2026-02/{Guid.NewGuid():N}_receipt.jpg",
            DateTime.UtcNow);
    }
}

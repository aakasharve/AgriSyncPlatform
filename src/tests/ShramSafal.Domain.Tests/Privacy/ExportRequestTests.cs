// spec: data-principle-spine-2026-05-05/08.1
using FluentAssertions;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class ExportRequestTests
{
    private static readonly DateTime FixedNow = new(2026, 5, 17, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Submit_carries_requested_status_and_user()
    {
        var u = Guid.NewGuid();
        var req = ExportRequest.Submit(u, FixedNow);

        req.Status.Should().Be(ExportRequestStatus.Requested);
        req.RequestedByUserId.Should().Be(u);
        req.TargetUserId.Should().Be(u);
        req.PresignedUrl.Should().BeNull();
        req.ExpiresAtUtc.Should().BeNull();
    }

    [Fact]
    public void Submit_rejects_empty_user()
    {
        Action act = () => ExportRequest.Submit(Guid.Empty, FixedNow);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void MarkCompleted_stamps_presignedUrl_and_expiry()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();
        req.MarkCompleted("https://example.com/zip", FixedNow.AddHours(24), FixedNow.AddMinutes(5));

        req.Status.Should().Be(ExportRequestStatus.Completed);
        req.PresignedUrl.Should().Be("https://example.com/zip");
        req.ExpiresAtUtc.Should().Be(FixedNow.AddHours(24));
    }

    [Fact]
    public void MarkCompleted_rejects_empty_url()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();
        Action act = () => req.MarkCompleted("  ", FixedNow.AddHours(1), FixedNow);
        act.Should().Throw<ArgumentException>();
    }
}

// spec: data-principle-spine-2026-05-05/08.1
using FluentAssertions;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Privacy;
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

    /// <summary>
    /// Shape of a real SigV4 presigned URL — the signature is what makes it a
    /// link rather than an address. Value is fabricated, structure is not.
    /// </summary>
    private const string SignedUrl =
        "https://agrisync-raw.s3.ap-south-1.amazonaws.com/raw/abc123"
        + "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        + "&X-Amz-Credential=EXAMPLE%2F20260517%2Fap-south-1%2Fs3%2Faws4_request"
        + "&X-Amz-Date=20260517T120000Z"
        + "&X-Amz-Expires=86400"
        + "&X-Amz-SignedHeaders=host"
        + "&X-Amz-Signature=0000000000000000000000000000000000000000000000000000000000000000";

    [Fact]
    public void MarkCompleted_stamps_presignedUrl_and_expiry()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();
        req.MarkCompleted(SignedUrl, FixedNow.AddHours(24), FixedNow.AddMinutes(5));

        req.Status.Should().Be(ExportRequestStatus.Completed);
        req.PresignedUrl.Should().Be(SignedUrl);
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

    // =====================================================================
    // §P0.9 — the download link must carry authority, not just characters.
    //
    // The worker used to hand this method a hand-concatenated URL with no
    // signature, against a bucket that 404s, and the request was stamped
    // Completed. Non-empty was the only thing anyone checked.
    // =====================================================================

    [Fact]
    public void MarkCompleted_refuses_an_unsigned_url_and_leaves_the_request_uncompleted()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();

        // Byte-for-byte the shape ExportWorker used to build.
        var fabricated =
            $"https://agrisync-exports.s3.amazonaws.com/exports/{Guid.NewGuid():N}/{Guid.NewGuid():N}.zip"
            + $"?expires={FixedNow.AddHours(24):O}";

        Action act = () => req.MarkCompleted(fabricated, FixedNow.AddHours(24), FixedNow);

        act.Should().Throw<ArgumentException>()
            .WithMessage("*carries no signature*");

        // Refusal must not half-complete the request: no status change, and
        // above all no dead link left on the row.
        req.Status.Should().Be(ExportRequestStatus.InProgress);
        req.PresignedUrl.Should().BeNull();
        req.ExpiresAtUtc.Should().BeNull();
        req.CompletedAtUtc.Should().BeNull();
    }

    [Fact]
    public void MarkCompleted_refuses_a_url_with_a_query_string_but_no_signature_parameter()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();

        Action act = () => req.MarkCompleted(
            "https://agrisync-raw.s3.ap-south-1.amazonaws.com/raw/abc123?X-Amz-Expires=86400",
            FixedNow.AddHours(24),
            FixedNow);

        act.Should().Throw<ArgumentException>().WithMessage("*carries no signature*");
        req.PresignedUrl.Should().BeNull();
    }

    [Theory]
    [InlineData("http://agrisync-raw.s3.amazonaws.com/raw/abc?X-Amz-Signature=deadbeef")]
    [InlineData("raw/abc123?X-Amz-Signature=deadbeef")]
    [InlineData("s3://agrisync-raw/raw/abc123?X-Amz-Signature=deadbeef")]
    public void MarkCompleted_refuses_anything_that_is_not_an_absolute_https_url(string candidate)
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();

        Action act = () => req.MarkCompleted(candidate, FixedNow.AddHours(24), FixedNow);

        act.Should().Throw<ArgumentException>().WithMessage("*absolute https*");
        req.PresignedUrl.Should().BeNull();
    }

    [Fact]
    public void MarkCompleted_accepts_a_sigv2_signature_parameter_too()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();

        req.MarkCompleted(
            "https://agrisync-raw.s3.amazonaws.com/raw/abc123?AWSAccessKeyId=EXAMPLE&Expires=1&Signature=abc%3D",
            FixedNow.AddHours(24),
            FixedNow);

        req.Status.Should().Be(ExportRequestStatus.Completed);
    }

    [Fact]
    public void An_export_that_cannot_hand_over_a_link_records_the_reason_rather_than_a_dead_link()
    {
        var req = ExportRequest.Submit(Guid.NewGuid(), FixedNow);
        req.MarkInProgress();

        req.MarkFailed(ExportWorker.NoSignerReason, FixedNow.AddMinutes(2));

        req.Status.Should().Be(ExportRequestStatus.Failed);
        req.FailureReason.Should().Contain("could not issue a download link");
        // The honest surface must also say what did NOT happen, or a farmer
        // reads "failed" as "my data is gone".
        req.FailureReason.Should().Contain("nothing has been deleted");
        req.PresignedUrl.Should().BeNull();
        req.ExpiresAtUtc.Should().BeNull();
    }

    [Fact]
    public void The_no_signer_reason_fits_the_failure_reason_column()
    {
        // ssf.export_requests.failure_reason is varchar(1024)
        // (ExportRequestConfiguration.cs). A longer message would throw at
        // SaveChanges and the worker's honest path would itself fail silently.
        ExportWorker.NoSignerReason.Length.Should().BeLessThanOrEqualTo(1024);
        ExportWorker.NoSignerReason.Should().NotBeNullOrWhiteSpace();
    }
}

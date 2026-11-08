// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 1)
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The entity of one product-identity answer: his हो / नाही / फोटो on one product of one record (D-92 append-only,
/// D-95 the server sets <c>IsCheck</c>). Pure rules only; the privilege and row-policy proofs are real-Postgres tests
/// (<c>InputIdentityAssertionsRealPostgresTests</c>).
/// </summary>
public sealed class InputIdentityAssertionTests
{
    private static readonly DateTime At = new(2026, 11, 8, 6, 30, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("a1000000-0000-4000-8000-000000000001"));
    private static readonly UserId By = new(Guid.Parse("a1000000-0000-4000-8000-000000000002"));

    private static InputIdentityAssertion Make(
        string spokenName = "calcium nitrate",
        IdentityVerdict verdict = IdentityVerdict.Confirmed,
        string? productId = "p-calcium-nitrate",
        bool isCheck = false,
        string inputEventId = "e1",
        int mixIndex = 0,
        string clientMutationId = "mut-1",
        Guid? attachmentId = null) =>
        InputIdentityAssertion.Record(
            Guid.NewGuid(), Farm, Guid.NewGuid(), Guid.NewGuid(), inputEventId, mixIndex, spokenName, productId, verdict,
            attachmentId, "inputs-2", By, At, clientMutationId, isCheck);

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Record_RejectsEmptySpokenName(string spokenName)
    {
        Assert.Throws<ArgumentException>(() => Make(spokenName: spokenName));
    }

    [Fact]
    public void Record_ConfirmedWithoutProductId_Throws()
    {
        Assert.Throws<ArgumentException>(() => Make(verdict: IdentityVerdict.Confirmed, productId: null));
        Assert.Throws<ArgumentException>(() => Make(verdict: IdentityVerdict.Confirmed, productId: "  "));
    }

    [Theory]
    [InlineData(IdentityVerdict.Rejected)]
    [InlineData(IdentityVerdict.Photo)]
    public void Record_RejectedOrPhoto_NeedsNoProductId(IdentityVerdict verdict)
    {
        var a = Make(verdict: verdict, productId: null, attachmentId: verdict == IdentityVerdict.Photo ? Guid.NewGuid() : null);

        Assert.Null(a.CatalogProductId);
        Assert.Equal(verdict, a.Verdict);
    }

    [Fact]
    public void Record_PhotoWithoutAnAttachment_Throws()
    {
        Assert.Throws<ArgumentException>(() => Make(verdict: IdentityVerdict.Photo, productId: null, attachmentId: null));
        Assert.Throws<ArgumentException>(() => Make(verdict: IdentityVerdict.Photo, productId: null, attachmentId: Guid.Empty));
    }

    [Fact]
    public void Record_ConfirmedOrRejected_MayCarryNoAttachment()
    {
        Assert.Null(Make(verdict: IdentityVerdict.Confirmed).AttachmentId);
        Assert.Null(Make(verdict: IdentityVerdict.Rejected, productId: null).AttachmentId);
    }

    [Fact]
    public void Record_KeepsEveryFieldAsGiven_AndTheServerSetsIsCheck()
    {
        var id = Guid.NewGuid();
        var plot = Guid.NewGuid();
        var log = Guid.NewGuid();
        var photo = Guid.NewGuid();

        var a = InputIdentityAssertion.Record(
            id, Farm, plot, log, "e7", 2, "  contof plus  ", null, IdentityVerdict.Photo, photo, "inputs-2.4", By, At, "mut-9", isCheck: true);

        Assert.Equal(id, a.Id);
        Assert.Equal(Farm, a.FarmId);
        Assert.Equal(plot, a.PlotId);
        Assert.Equal(log, a.DailyLogId);
        Assert.Equal("e7", a.InputEventId);
        Assert.Equal(2, a.MixIndex);
        Assert.Equal("contof plus", a.SpokenName);
        Assert.Equal(photo, a.AttachmentId);
        Assert.Equal("inputs-2.4", a.CatalogVersion);
        Assert.Equal(By, a.AssertedByUserId);
        Assert.Equal(At, a.AssertedAtUtc);
        Assert.Equal("mut-9", a.ClientMutationId);
        Assert.True(a.IsCheck);
    }

    [Fact]
    public void Record_MakesNoPlotRequired()
    {
        var a = InputIdentityAssertion.Record(
            Guid.NewGuid(), Farm, plotId: null, Guid.NewGuid(), "e1", 0, "x", null, IdentityVerdict.Rejected, null, "inputs-2", By, At, "m");

        Assert.Null(a.PlotId);
        Assert.False(a.IsCheck);
    }

    [Fact]
    public void Record_RefusesAMissingIdentity()
    {
        Assert.Throws<ArgumentException>(() => InputIdentityAssertion.Record(
            Guid.Empty, Farm, null, Guid.NewGuid(), "e1", 0, "x", null, IdentityVerdict.Rejected, null, "inputs-2", By, At, "m"));
        Assert.Throws<ArgumentException>(() => InputIdentityAssertion.Record(
            Guid.NewGuid(), new FarmId(Guid.Empty), null, Guid.NewGuid(), "e1", 0, "x", null, IdentityVerdict.Rejected, null, "inputs-2", By, At, "m"));
        Assert.Throws<ArgumentException>(() => InputIdentityAssertion.Record(
            Guid.NewGuid(), Farm, null, Guid.Empty, "e1", 0, "x", null, IdentityVerdict.Rejected, null, "inputs-2", By, At, "m"));
        Assert.Throws<ArgumentException>(() => InputIdentityAssertion.Record(
            Guid.NewGuid(), Farm, null, Guid.NewGuid(), "e1", 0, "x", null, IdentityVerdict.Rejected, null, "inputs-2", UserId.Empty, At, "m"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void Record_RefusesABlankItemIdOrRequestId(string blank)
    {
        Assert.Throws<ArgumentException>(() => Make(inputEventId: blank));
        Assert.Throws<ArgumentException>(() => Make(clientMutationId: blank));
    }

    [Fact]
    public void Record_RefusesANegativeMixIndex_AndAnItemIdTooLong()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Make(mixIndex: -1));
        Assert.Throws<ArgumentException>(() => Make(inputEventId: new string('a', InputIdentityAssertion.MaxInputEventId + 1)));
        Assert.Throws<ArgumentException>(() => Make(clientMutationId: new string('a', InputIdentityAssertion.MaxClientMutationId + 1)));
    }

    [Fact]
    public void Record_ClipsAnOverlongSpokenName_RatherThanDroppingHisAnswer()
    {
        var a = Make(spokenName: new string('न', InputIdentityAssertion.MaxSpokenName + 40));

        Assert.Equal(InputIdentityAssertion.MaxSpokenName, a.SpokenName.Length);
    }

    [Fact]
    public void Record_AnUnknownVerdictValue_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Make(verdict: (IdentityVerdict)99));
    }

    [Theory]
    [InlineData("confirmed", IdentityVerdict.Confirmed)]
    [InlineData("rejected", IdentityVerdict.Rejected)]
    [InlineData("photo", IdentityVerdict.Photo)]
    [InlineData("Confirmed", IdentityVerdict.Confirmed)]
    public void Verdict_ReadsTheWireWords(string wire, IdentityVerdict expected)
    {
        Assert.True(IdentityVerdictWire.TryParse(wire, out var verdict));
        Assert.Equal(expected, verdict);
        Assert.Equal(expected.ToString().ToLowerInvariant(), IdentityVerdictWire.ToWire(verdict));
    }

    [Theory]
    [InlineData("yes")]
    [InlineData("")]
    [InlineData(null)]
    public void Verdict_RefusesAnyOtherWord(string? wire)
    {
        Assert.False(IdentityVerdictWire.TryParse(wire, out _));
    }
}

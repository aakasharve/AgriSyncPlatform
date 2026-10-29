using Accounts.Domain.Subscriptions;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.Subscriptions;

/// <summary>
/// spec R-11 (b) (founder N-1: "an explicit, server-managed pilot extension with a recorded reason
/// and end date") — what an extension must carry, and when it is in effect.
/// </summary>
public sealed class AccessExtensionTests
{
    private static readonly OwnerAccountId Account = new(Guid.Parse("0a000000-0000-0000-0000-0000000000bb"));
    private static readonly Guid Admin = Guid.Parse("11111111-1111-1111-1111-1111111111bb");
    private static readonly DateTime Start = new(2026, 10, 27, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime End = new(2026, 12, 31, 18, 30, 0, DateTimeKind.Utc);

    private static AccessExtension Grant(string reason = "pilot-extension-2026-10", DateTime? start = null, DateTime? end = null, Guid? by = null) =>
        AccessExtension.Grant(Guid.NewGuid(), Account, reason, start ?? Start, end ?? End, by ?? Admin, Start);

    [Fact(DisplayName = "An extension records the account, the reason, the window and who granted it")]
    public void Records_every_fact()
    {
        var extension = Grant("  pilot-extension-2026-10  ");

        Assert.Equal(Account, extension.OwnerAccountId);
        Assert.Equal("pilot-extension-2026-10", extension.Reason);
        Assert.Equal(Start, extension.StartsAtUtc);
        Assert.Equal(End, extension.EndsAtUtc);
        Assert.Equal(Admin, extension.GrantedByUserId);
        Assert.Equal(Start, extension.CreatedAtUtc);
    }

    [Fact(DisplayName = "Start is inclusive, end is exclusive")]
    public void Window_is_half_open()
    {
        var extension = Grant();

        Assert.False(extension.IsActiveAt(Start.AddTicks(-1)));
        Assert.True(extension.IsActiveAt(Start));
        Assert.True(extension.IsActiveAt(End.AddTicks(-1)));
        Assert.False(extension.IsActiveAt(End));
    }

    [Theory(DisplayName = "No reason, no extension")]
    [InlineData("")]
    [InlineData("   ")]
    public void Reason_is_required(string reason) =>
        Assert.Throws<ArgumentException>(() => Grant(reason));

    [Fact(DisplayName = "A reason longer than the column is refused, never cut")]
    public void Reason_is_bounded() =>
        Assert.Throws<ArgumentException>(() => Grant(new string('x', AccessExtension.MaxReasonLength + 1)));

    [Fact(DisplayName = "An extension must end after it starts")]
    public void End_after_start()
    {
        Assert.Throws<ArgumentException>(() => Grant(start: End, end: Start));
        Assert.Throws<ArgumentException>(() => Grant(start: Start, end: Start));
    }

    [Fact(DisplayName = "Who granted it is required")]
    public void Granter_is_required() =>
        Assert.Throws<ArgumentException>(() => Grant(by: Guid.Empty));

    [Fact(DisplayName = "The owner account is required")]
    public void Account_is_required() =>
        Assert.Throws<ArgumentException>(() =>
            AccessExtension.Grant(Guid.NewGuid(), new OwnerAccountId(Guid.Empty), "x", Start, End, Admin, Start));
}

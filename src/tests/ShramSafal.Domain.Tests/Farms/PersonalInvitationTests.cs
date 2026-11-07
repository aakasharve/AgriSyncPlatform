using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. The personal invitation's pure rules: seven days, single
/// use, eight digits, only enforced authorities, and a seat that becomes Active with EXACTLY the grant.
/// </summary>
public sealed class PersonalInvitationTests
{
    private static readonly DateTime Now = new(2026, 11, 6, 6, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("d2a20001-0000-0000-0000-000000000001"));
    private static readonly UserId Owner = new(Guid.Parse("d2a20001-0000-0000-0000-0000000000a1"));
    private static readonly UserId Joiner = new(Guid.Parse("d2a20001-0000-0000-0000-0000000000e1"));
    private static readonly Guid Plot1 = Guid.Parse("d2a20001-0000-0000-0000-0000000001a1");

    private static PersonalInvitation Make(
        RelationshipLabel label = RelationshipLabel.Family,
        IReadOnlyDictionary<FarmAuthority, DateTime?>? authorities = null,
        MembershipPlotScope scope = MembershipPlotScope.ChosenPlots,
        string? phone = "+916000012345",
        string code = "48217730") =>
        PersonalInvitation.Create(
            Guid.NewGuid(), Farm, "पाटील फार्म", Owner, label, "रमेश", phone, null, scope,
            scope == MembershipPlotScope.ChosenPlots ? [Plot1] : [],
            scope == MembershipPlotScope.ChosenPlots ? ["प्लॉट 1"] : [],
            authorities ?? new Dictionary<FarmAuthority, DateTime?>
            {
                [FarmAuthority.TakeAttendance] = null,
                [FarmAuthority.ConfirmRecords] = Now.AddDays(20),
            },
            code,
            Now);

    [Fact]
    public void It_lasts_seven_days_waits_and_names_the_number_it_was_given()
    {
        var invitation = Make();
        Assert.Equal(Now.AddDays(7), invitation.ExpiresAtUtc);
        Assert.Equal(PersonalInvitationStatus.Waiting, invitation.StatusAt(Now));
        Assert.Equal(PersonalInvitationStatus.Expired, invitation.StatusAt(Now.AddDays(7)));
        Assert.True(invitation.Names("+916000012345"));
        Assert.False(invitation.Names("+916000054321"));
        Assert.False(invitation.Names(null));
        Assert.Equal("https://shramsafal.in/i/48217730", PersonalInvitationCode.LinkOf(invitation.Code));
    }

    [Fact]
    public void A_grant_the_server_would_not_hold_is_refused()
    {
        // AssignWork is not enforced yet (it waits for L8c); PlanWork became enforced with lane L8b-1 (D-73).
        Assert.Throws<ArgumentException>(() => Make(authorities: new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.AssignWork] = null }));
        Assert.Throws<ArgumentException>(() => Make(authorities: new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.SeeWages] = null }));
        Assert.Throws<ArgumentException>(() => Make(authorities: new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.TakeAttendance] = Now }));
        Assert.Throws<ArgumentException>(() => Make(code: "1234567"));
        Assert.Throws<ArgumentException>(() => Make(phone: "6000012345"));
        Assert.Throws<ArgumentException>(() => PersonalInvitation.Create(
            Guid.NewGuid(), Farm, "f", Owner, RelationshipLabel.Worker, null, null, null, MembershipPlotScope.ChosenPlots,
            [], [], new Dictionary<FarmAuthority, DateTime?>(), "48217730", Now));
    }

    [Fact]
    public void It_is_used_once_and_an_ended_one_refuses_every_answer()
    {
        var invitation = Make();
        invitation.Accept(Joiner, Guid.NewGuid(), waitsForOwner: false, Now.AddHours(1));
        Assert.Equal(PersonalInvitationStatus.Accepted, invitation.StatusAt(Now.AddHours(2)));
        Assert.Throws<InvalidOperationException>(() => invitation.Accept(Joiner, Guid.NewGuid(), false, Now.AddHours(2)));
        Assert.Throws<InvalidOperationException>(() => invitation.Decline(Joiner, Now.AddHours(2)));
        Assert.False(invitation.Withdraw(Owner, Now.AddHours(2)));

        var expired = Make(code: "11112222");
        Assert.Throws<InvalidOperationException>(() => expired.Accept(Joiner, Guid.NewGuid(), false, Now.AddDays(8)));

        var mine = Make(code: "33334444");
        Assert.Throws<InvalidOperationException>(() => mine.Accept(Owner, Guid.NewGuid(), false, Now.AddHours(1)));

        var withdrawn = Make(code: "55556666");
        Assert.True(withdrawn.Withdraw(Owner, Now.AddHours(1)));
        Assert.Equal(PersonalInvitationStatus.Withdrawn, withdrawn.StatusAt(Now.AddHours(1)));
        Assert.Throws<InvalidOperationException>(() => withdrawn.Decline(Joiner, Now.AddHours(2)));
    }

    [Fact]
    public void An_end_that_has_passed_since_the_owner_chose_it_grants_nothing_and_takes_what_needed_it()
    {
        var invitation = Make(authorities: new Dictionary<FarmAuthority, DateTime?>
        {
            [FarmAuthority.SeeMoney] = Now.AddDays(2),
            [FarmAuthority.SeeWages] = null,
            [FarmAuthority.TakeAttendance] = null,
        });

        var alive = invitation.AuthoritiesAliveAt(Now.AddDays(3));
        Assert.Equal([FarmAuthority.TakeAttendance], alive.Keys.ToList());
    }

    /// <summary>
    /// lane MU-2 fix round 1 (review M-2, P5) — an authority that does nothing on the grant (the team card's "not in force"
    /// rule) is refused when the invitation is made, so the card can never promise it.
    /// </summary>
    [Theory]
    [InlineData(RelationshipLabel.Worker, MembershipPlotScope.OwnWork, FarmAuthority.SeeMoney)]
    [InlineData(RelationshipLabel.Worker, MembershipPlotScope.ChosenPlots, FarmAuthority.SeeMoney)]
    [InlineData(RelationshipLabel.Family, MembershipPlotScope.OwnWork, FarmAuthority.SeeMoney)]
    [InlineData(RelationshipLabel.Family, MembershipPlotScope.ChosenPlots, FarmAuthority.EditFarmSetup)]
    [InlineData(RelationshipLabel.Mukadam, MembershipPlotScope.OwnWork, FarmAuthority.EditFarmSetup)]
    public void An_authority_not_in_force_on_the_grant_is_refused(
        RelationshipLabel label, MembershipPlotScope scope, FarmAuthority authority)
    {
        Assert.Throws<ArgumentException>(() => Make(
            label: label, scope: scope, authorities: new Dictionary<FarmAuthority, DateTime?> { [authority] = null }));
    }

    [Fact]
    public void Money_and_farm_setup_are_in_force_on_every_plot()
    {
        var invitation = Make(
            label: RelationshipLabel.CoOwner,
            scope: MembershipPlotScope.AllPlots,
            authorities: new Dictionary<FarmAuthority, DateTime?> { [FarmAuthority.SeeMoney] = null, [FarmAuthority.EditFarmSetup] = null });
        Assert.Equal(2, invitation.Authorities().Count);
    }

    [Theory]
    [InlineData("48217730", "48217730")]
    [InlineData(" 4821-7730 ", "48217730")]
    [InlineData("४८२१ ७७३०", "48217730")]
    [InlineData("https://shramsafal.in/i/4821-7730", "48217730")]
    [InlineData("K7M2QP", null)]
    [InlineData("482177", null)]
    [InlineData("482177301", null)]
    [InlineData("", null)]
    public void The_code_is_read_the_way_people_type_or_paste_it(string typed, string? expected)
    {
        Assert.Equal(expected, PersonalInvitationCode.Normalize(typed));
    }

    [Fact]
    public void A_new_code_is_eight_digits()
    {
        for (var i = 0; i < 50; i++)
        {
            Assert.Matches("^[0-9]{8}$", PersonalInvitationCode.New());
        }
    }

    [Fact]
    public void Labels_grant_nothing_and_ownership_is_never_one_of_them()
    {
        Assert.Equal(AppRole.SecondaryOwner, RelationshipLabels.RoleOf(RelationshipLabel.Family));
        Assert.Equal(AppRole.SecondaryOwner, RelationshipLabels.RoleOf(RelationshipLabel.CoOwner));
        Assert.Equal(RelationshipLabel.Family, RelationshipLabels.Parse("family"));
        Assert.Null(RelationshipLabels.Parse("PrimaryOwner"));
        Assert.Null(RelationshipLabels.Parse("1"));
        Assert.Null(RelationshipLabels.Parse(null));
    }

    [Fact]
    public void A_claimed_seat_waits_with_nothing_then_activates_with_exactly_the_grant()
    {
        var invitation = Make();
        var seat = FarmMembership.CreateFromPersonalInvitation(Guid.NewGuid(), invitation, Joiner, Now.AddHours(1));

        Assert.Equal(MembershipStatus.PendingApproval, seat.Status);
        Assert.Equal(RelationshipLabel.Family, seat.Label);
        Assert.Equal(AppRole.SecondaryOwner, seat.Role);
        Assert.Equal(JoinedVia.PersonalInvitation, seat.JoinedVia);
        Assert.Equal(invitation.Id, seat.PersonalInvitationId);
        Assert.False(seat.Holds(FarmAuthority.TakeAttendance, Now.AddHours(1)));
        Assert.Throws<InvalidOperationException>(() => seat.LinkWorkerRecord(Guid.NewGuid()));

        seat.ActivateFromPersonalInvitation(Owner, invitation, Now.AddHours(2));

        Assert.Equal(MembershipStatus.Active, seat.Status);
        Assert.Equal(Owner, seat.ApprovedByUserId);
        Assert.True(seat.Holds(FarmAuthority.TakeAttendance, Now.AddHours(2)));
        Assert.True(seat.Holds(FarmAuthority.ConfirmRecords, Now.AddHours(2)));
        Assert.Equal(Now.AddDays(20), seat.ExpiryOf(FarmAuthority.ConfirmRecords));
        Assert.False(seat.Holds(FarmAuthority.SeeMoney, Now.AddHours(2)));
        Assert.False(seat.Holds(FarmAuthority.EditFarmSetup, Now.AddHours(2)));
        Assert.Equal(MembershipPlotScope.ChosenPlots, seat.PlotScope);
        Assert.Equal([Plot1], seat.ScopePlotIds.ToList());

        var record = Guid.NewGuid();
        seat.LinkWorkerRecord(record);
        Assert.Equal(record, seat.FieldOperatorId);
        Assert.Throws<InvalidOperationException>(() => seat.LinkWorkerRecord(Guid.NewGuid()));
    }

    [Fact]
    public void A_generic_request_carries_the_invitation_and_only_that_invitation_activates_it()
    {
        var request = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Joiner, Now);
        Assert.True(request.IsGenericJoinRequest);

        var invitation = Make(label: RelationshipLabel.Mukadam, scope: MembershipPlotScope.AllPlots);
        var other = Make(label: RelationshipLabel.Worker, scope: MembershipPlotScope.AllPlots, code: "99998888");
        request.AttachPersonalInvitation(invitation, Now.AddMinutes(5));

        Assert.False(request.IsGenericJoinRequest);
        Assert.Equal(MembershipStatus.PendingApproval, request.Status);
        Assert.Equal(AppRole.Mukadam, request.Role);
        Assert.Throws<InvalidOperationException>(() => request.ActivateFromPersonalInvitation(Owner, other, Now.AddMinutes(6)));

        request.ActivateFromPersonalInvitation(Owner, invitation, Now.AddMinutes(6));
        Assert.Equal(MembershipStatus.Active, request.Status);
        Assert.Equal(RelationshipLabel.Mukadam, request.Label);
    }
}

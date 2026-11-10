// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 3 (R31, R32; founder D-74, D-88 = "you, plus the people you give
// 'पीक वेळापत्रकाचे नमुने'"). OwnScheduleGate answers ONE question: may this person write the OWN schedule of THIS farm? The farm's primary
// owner, or an ACTIVE seat that holds "पीक वेळापत्रकाचे नमुने" there. The account's global role and the seat's LABEL decide nothing (R31, D-26).
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class OwnScheduleGateTests
{
    private static readonly DateTime Now = new(2026, 11, 9, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmId = Guid.Parse("a0a00000-0000-4000-8000-0000000000a1");
    private static readonly Guid OtherFarmId = Guid.Parse("a0a00000-0000-4000-8000-0000000000b1");
    private static readonly Guid OwnerId = Guid.Parse("a0a00000-0000-4000-8000-000000000011");
    private static readonly Guid SeatId = Guid.Parse("a0a00000-0000-4000-8000-000000000012");
    private static readonly Guid StrangerId = Guid.Parse("a0a00000-0000-4000-8000-000000000013");

    /// <summary>A repository that knows one farm and the seats it is given; everything else throws (a gate must not read more).</summary>
    private sealed class Repo(Farm? farm, Dictionary<(Guid Farm, Guid User), FarmAccess> seats)
        : FakeShramSafalRepository, ShramSafal.Application.Ports.IShramSafalRepository
    {
        public int AccessReads { get; private set; }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(farm is not null && (Guid)farm.Id == farmId ? farm : null);

        public Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            AccessReads++;
            return Task.FromResult(seats.GetValueOrDefault((farmId, userId)));
        }
    }

    private static Farm TheFarm() => Farm.Create(new FarmId(FarmId), "शेत A", new UserId(OwnerId), Now);

    private static FarmAccess Seat(AppRole role, FarmPermission? stored, MembershipStatus status = MembershipStatus.Active) =>
        new(role, status, IsRegistrant: false, StoredPermissions: stored);

    private static Task<bool> AsksAsync(Repo repo, Guid farm, Guid user) => OwnScheduleGate.AllowsAsync(repo, farm, user, Now);

    [Fact]
    public async Task The_primary_owner_succeeds_without_any_seat_read()
    {
        var repo = new Repo(TheFarm(), []);

        (await AsksAsync(repo, FarmId, OwnerId)).Should().BeTrue();
        repo.AccessReads.Should().Be(0, "the owner is the owner; no authority is read");
    }

    // spec: plr-d10 lane SCH-OWN-c (E4; founder D-137 Q9 = 1) - the gate also NAMES the farm's owner, the person a new own chain belongs to.
    [Fact]
    public async Task OwnerIfAllowed_answers_the_farms_owner_for_the_owner_and_for_a_holder_and_null_for_everyone_else()
    {
        var holder = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(AppRole.Mukadam, FarmPermission.ManageScheduleTemplates) });

        (await OwnScheduleGate.OwnerIfAllowedAsync(holder, FarmId, OwnerId, Now)).Should().Be(OwnerId);
        (await OwnScheduleGate.OwnerIfAllowedAsync(holder, FarmId, SeatId, Now)).Should().Be(OwnerId, "the OWNER's id, never the holder's (Q9 = 1)");
        (await OwnScheduleGate.OwnerIfAllowedAsync(holder, FarmId, StrangerId, Now)).Should().BeNull();
        holder.AccessReads.Should().Be(2, "the owner needs no seat read; the holder and the stranger one each");

        var noAuthority = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney) });
        (await OwnScheduleGate.OwnerIfAllowedAsync(noAuthority, FarmId, SeatId, Now)).Should().BeNull();
        (await OwnScheduleGate.OwnerIfAllowedAsync(new Repo(null, []), FarmId, OwnerId, Now)).Should().BeNull("a farm that cannot be read fails closed");
        (await OwnScheduleGate.OwnerIfAllowedAsync(holder, Guid.Empty, OwnerId, Now)).Should().BeNull();
        (await OwnScheduleGate.OwnerIfAllowedAsync(holder, FarmId, Guid.Empty, Now)).Should().BeNull();
    }

    [Fact]
    public async Task A_seat_holding_ScheduleTemplates_succeeds_whatever_its_label()
    {
        foreach (var role in new[] { AppRole.SecondaryOwner, AppRole.Mukadam, AppRole.Worker })
        {
            var repo = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(role, FarmPermission.ManageScheduleTemplates) });
            (await AsksAsync(repo, FarmId, SeatId)).Should().BeTrue($"{role} holding the authority");
        }
    }

    [Fact]
    public async Task The_same_person_without_the_authority_is_refused()
    {
        var repo = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(AppRole.Mukadam, FarmPermission.SeeMoney | FarmPermission.PlanWork) });
        (await AsksAsync(repo, FarmId, SeatId)).Should().BeFalse();
    }

    [Fact]
    public async Task A_SecondaryOwner_label_without_the_seat_authority_is_refused()
    {
        // R31: the account's role is not the seat's authority. A सहमालक whose owner switched the schedule authority off gets nothing.
        var repo = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney | FarmPermission.EditFarmSetup) });
        (await AsksAsync(repo, FarmId, SeatId)).Should().BeFalse();
    }

    [Fact]
    public async Task Holding_it_on_another_farm_only_is_refused_here()
    {
        var repo = new Repo(TheFarm(), new() { [(OtherFarmId, SeatId)] = Seat(AppRole.Mukadam, FarmPermission.ManageScheduleTemplates) });
        (await AsksAsync(repo, FarmId, SeatId)).Should().BeFalse();
    }

    [Fact]
    public async Task A_paused_or_waiting_seat_that_stores_the_authority_is_refused()
    {
        foreach (var status in new[] { MembershipStatus.Suspended, MembershipStatus.PendingApproval, MembershipStatus.Revoked, MembershipStatus.Exited })
        {
            var repo = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(AppRole.SecondaryOwner, FarmPermission.ManageScheduleTemplates, status) });
            (await AsksAsync(repo, FarmId, SeatId)).Should().BeFalse($"{status}");
        }
    }

    [Fact]
    public async Task A_stranger_and_an_unreadable_farm_are_refused()
    {
        (await AsksAsync(new Repo(TheFarm(), []), FarmId, StrangerId)).Should().BeFalse();
        (await AsksAsync(new Repo(null, []), FarmId, OwnerId)).Should().BeFalse("a farm that cannot be read fails closed");
    }

    [Fact]
    public async Task Another_farms_owner_is_not_this_farms_owner()
    {
        var repo = new Repo(TheFarm(), []);
        (await AsksAsync(repo, FarmId, Guid.Parse("b0b00000-0000-4000-8000-000000000011"))).Should().BeFalse();
    }

    [Fact]
    public async Task An_empty_farm_or_person_is_refused()
    {
        var repo = new Repo(TheFarm(), new() { [(FarmId, SeatId)] = Seat(AppRole.Mukadam, FarmPermission.ManageScheduleTemplates) });
        (await AsksAsync(repo, Guid.Empty, SeatId)).Should().BeFalse();
        (await AsksAsync(repo, FarmId, Guid.Empty)).Should().BeFalse();
    }
}

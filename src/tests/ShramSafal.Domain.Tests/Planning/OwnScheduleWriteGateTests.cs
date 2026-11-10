// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 3 (R31, R32; D4, D5, D11; E4) and lane SCH-OWN-c (founder D-137; F222).
// The write gate of the schedule-template doors, asked as the handlers ask it, against a fake that COUNTS what is read. Pure: no I/O.
// The order matters and is pinned here: a person's own chain may be written only naming a farm whose OWNER is the chain's owner - the named farm is
// read ONCE and compared BEFORE any authority is read (D11, re-aimed); then the gate on that farm (its owner, or an Active seat holding the authority
// there). The clone-into-own gate is asked BEFORE anything about the farm or the source is learned (E4); a delegate no longer versions the owner's
// Team chain that names no owner (R32).
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class OwnScheduleWriteGateTests
{
    private static readonly DateTime Now = new(2026, 11, 9, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmA = Guid.Parse("a0a00000-0000-4000-8000-0000000000a1");
    private static readonly Guid FarmB = Guid.Parse("a0a00000-0000-4000-8000-0000000000b1");
    private static readonly Guid FarmOfOtherOwner = Guid.Parse("a0a00000-0000-4000-8000-0000000000c1");
    private static readonly Guid Owner = Guid.Parse("a0a00000-0000-4000-8000-000000000011");
    private static readonly Guid Delegate = Guid.Parse("a0a00000-0000-4000-8000-000000000012");
    private static readonly Guid Plain = Guid.Parse("a0a00000-0000-4000-8000-000000000013");
    private static readonly Guid Outsider = Guid.Parse("a0a00000-0000-4000-8000-000000000014");
    private static readonly Guid HolderB = Guid.Parse("a0a00000-0000-4000-8000-000000000015");
    private static readonly Guid SeatOfBoth = Guid.Parse("a0a00000-0000-4000-8000-000000000016");

    /// <summary>
    /// One owner with farms A and B, an outsider who owns a third farm; a delegate holding the authority on A, a seat holding none, a holder on B
    /// only, a seat of A and of the outsider's farm. Counts what is read.
    /// </summary>
    private sealed class Repo : FakeShramSafalRepository, IShramSafalRepository
    {
        public Dictionary<Guid, ScheduleTemplate> Templates { get; } = [];
        public Dictionary<(Guid Farm, Guid User), FarmAccess> Seats { get; } = [];
        public Dictionary<Guid, List<Guid>> FarmsOf { get; } = [];
        public List<ScheduleCheck> Checks { get; } = [];
        public List<CropCycle> Seasons { get; } = [];
        public int AuthorityReads { get; private set; }
        public int FarmReads { get; private set; }
        public int CheckReads { get; private set; }
        public int SeasonReads { get; private set; }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
        {
            FarmReads++;
            return Task.FromResult<Farm?>(
                farmId == FarmA || farmId == FarmB ? Farm.Create(new FarmId(farmId), "शेत", new UserId(Owner), Now)
                : farmId == FarmOfOtherOwner ? Farm.Create(new FarmId(farmId), "दुसऱ्याचं शेत", new UserId(Outsider), Now)
                : null);
        }

        public Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            AuthorityReads++;
            return Task.FromResult(Seats.GetValueOrDefault((farmId, userId)));
        }

        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(FarmsOf.GetValueOrDefault(userId) ?? []);

        public override Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
            Task.FromResult(Templates.GetValueOrDefault(templateId));

        public Task<IReadOnlyList<ScheduleCheck>> GetScheduleChecksAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct = default)
        {
            CheckReads++;
            return Task.FromResult<IReadOnlyList<ScheduleCheck>>(Checks.Where(c => ids.Contains(c.ScheduleTemplateId)).ToList());
        }

        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        {
            SeasonReads++;
            return Task.FromResult(Seasons.Where(s => farmIds.Contains((Guid)s.FarmId)).ToList());
        }
    }

    private static Repo World()
    {
        var repo = new Repo();
        repo.FarmsOf[Owner] = [FarmA, FarmB];
        repo.FarmsOf[Delegate] = [FarmA];
        repo.FarmsOf[Plain] = [FarmA];
        repo.FarmsOf[HolderB] = [FarmB];
        repo.FarmsOf[Outsider] = [FarmOfOtherOwner];
        repo.FarmsOf[SeatOfBoth] = [FarmA, FarmOfOtherOwner];
        repo.Seats[(FarmA, Delegate)] = new(AppRole.SecondaryOwner, MembershipStatus.Active, false, FarmPermission.ManageScheduleTemplates);
        repo.Seats[(FarmA, Plain)] = new(AppRole.SecondaryOwner, MembershipStatus.Active, false, FarmPermission.SeeMoney);
        repo.Seats[(FarmA, Owner)] = new(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);
        repo.Seats[(FarmB, Owner)] = new(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);
        repo.Seats[(FarmB, HolderB)] = new(AppRole.Mukadam, MembershipStatus.Active, false, FarmPermission.ManageScheduleTemplates);
        repo.Seats[(FarmA, SeatOfBoth)] = new(AppRole.SecondaryOwner, MembershipStatus.Active, false, FarmPermission.ManageScheduleTemplates);
        repo.Seats[(FarmOfOtherOwner, SeatOfBoth)] = new(AppRole.Worker, MembershipStatus.Active, false, FarmPermission.SeeMoney);
        return repo;
    }

    /// <summary>A person's own chain (owner <paramref name="owner"/>), typed by <paramref name="maker"/>.</summary>
    private static ScheduleTemplate OwnChain(Repo repo, Guid owner, Guid maker)
    {
        var own = ScheduleTemplate.CreateOwn(Guid.NewGuid(), "माझं", "Grapes", new UserId(owner), new UserId(maker), Now);
        repo.Templates[own.Id] = own;
        return own;
    }

    private static ScheduleTemplate PlainTeam(Repo repo, Guid maker, TenantScope scope = TenantScope.Team)
    {
        var chain = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes", "Pruning", Now, new UserId(maker), scope);
        repo.Templates[chain.Id] = chain;
        return chain;
    }

    private static Task<Error?> EditAsync(Repo repo, ScheduleTemplate source, Guid? farm, Guid caller, AppRole role = AppRole.Worker) =>
        ScheduleTemplateWriteGate.RefuseEditAsync(repo, source, farm, caller, role, Now, CancellationToken.None);

    private static Task<Error?> PublishAsync(Repo repo, ScheduleTemplate source, Guid? farm, Guid caller, AppRole role = AppRole.Worker) =>
        ScheduleTemplateWriteGate.RefusePublishAsync(repo, source, farm, caller, role, Now, CancellationToken.None);

    // ---- D11 re-aimed: the farm named must be one of the OWNER's farms, read once, before any authority is read -------

    [Fact]
    public async Task Naming_a_farm_whose_owner_is_not_the_chains_owner_is_refused_before_any_authority_is_read()
    {
        var repo = World();
        var chain = OwnChain(repo, Owner, Owner);

        // The owner himself, naming another owner's farm (the viewer answers "his" without a read; the named farm is read ONCE to compare its owner).
        (await EditAsync(repo, chain, FarmOfOtherOwner, Owner)).Should().Be(ShramSafalErrors.Forbidden);
        repo.FarmReads.Should().Be(1, "the named farm was read once, to compare its owner");
        repo.AuthorityReads.Should().Be(0, "and no seat was read: the farm named was refused first");

        (await PublishAsync(repo, chain, FarmOfOtherOwner, Owner)).Should().Be(ShramSafalErrors.Forbidden);
        repo.AuthorityReads.Should().Be(0);

        // A seat of farm A who holds the authority there, naming the other owner's farm: the same refusal, still no authority read.
        (await EditAsync(repo, chain, FarmOfOtherOwner, Delegate)).Should().Be(ShramSafalErrors.Forbidden);
        repo.AuthorityReads.Should().Be(0);
    }

    [Fact]
    public async Task No_farm_named_on_the_persons_own_chain_is_refused_for_edit_and_for_publish()
    {
        var repo = World();
        var chain = OwnChain(repo, Owner, Owner);

        (await EditAsync(repo, chain, null, Owner)).Should().Be(ShramSafalErrors.Forbidden);
        (await EditAsync(repo, chain, Guid.Empty, Owner)).Should().Be(ShramSafalErrors.Forbidden);
        (await PublishAsync(repo, chain, null, Owner)).Should().Be(ShramSafalErrors.Forbidden);
        repo.AuthorityReads.Should().Be(0);
        repo.FarmReads.Should().Be(0);
    }

    // ---- his own chain: the gate on the farm named ------------------------------------------------------------------

    [Fact]
    public async Task The_owner_and_a_holder_edit_and_publish_his_own_chain_and_a_seat_without_it_does_not()
    {
        var repo = World();
        var chain = OwnChain(repo, Owner, Owner);

        (await EditAsync(repo, chain, FarmA, Owner)).Should().BeNull();
        (await EditAsync(repo, chain, FarmA, Delegate)).Should().BeNull("the seat decides, not the label");
        (await EditAsync(repo, chain, FarmA, Plain)).Should().Be(ShramSafalErrors.Forbidden);
        (await PublishAsync(repo, chain, FarmA, Owner)).Should().BeNull();
        (await PublishAsync(repo, chain, FarmA, Delegate)).Should().BeNull();
        (await PublishAsync(repo, chain, FarmA, Plain)).Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task A_holder_on_the_owners_other_farm_edits_and_publishes_naming_that_farm()
    {
        // R-c8 (founder-eyes): the library is the PERSON's (D-137) - a holder of the authority on ANY farm of the owner may version / publish his
        // schedule naming that farm; an edit never moves a plot (Q8). Naming a farm where he holds nothing is still refused.
        var repo = World();
        var chain = OwnChain(repo, Owner, Owner);

        (await EditAsync(repo, chain, FarmB, HolderB)).Should().BeNull("he holds the authority on farm B, which the owner owns");
        (await PublishAsync(repo, chain, FarmB, HolderB)).Should().BeNull();
        (await EditAsync(repo, chain, FarmA, HolderB)).Should().Be(ShramSafalErrors.Forbidden, "farm A is the owner's too, but he holds nothing there");
        (await PublishAsync(repo, chain, FarmA, HolderB)).Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task A_seat_of_both_owners_farms_sees_the_other_owners_chain_but_cannot_write_it_naming_the_farm_he_holds_on()
    {
        var repo = World();
        var chain = OwnChain(repo, Outsider, Outsider);
        var before = repo.AuthorityReads;

        // He works on the outsider's farm too, so he SEES the chain (the Team rule); he holds the authority on farm A only - farm A's owner is not
        // the chain's owner, so naming A is refused before any authority is read; naming the outsider's farm meets the gate, where he holds nothing.
        (await EditAsync(repo, chain, FarmA, SeatOfBoth)).Should().Be(ShramSafalErrors.Forbidden);
        repo.AuthorityReads.Should().Be(before, "farm A's owner is not the chain's owner: refused before any authority is read");
        (await EditAsync(repo, chain, FarmOfOtherOwner, SeatOfBoth)).Should().Be(ShramSafalErrors.Forbidden);
        (await PublishAsync(repo, chain, FarmOfOtherOwner, SeatOfBoth)).Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task The_global_role_decides_nothing_on_his_own_chain()
    {
        var repo = World();
        var chain = OwnChain(repo, Owner, Owner);

        // A Worker-token holder passes; a PrimaryOwner-token seat without the authority does not (R31).
        (await EditAsync(repo, chain, FarmA, Delegate, AppRole.Worker)).Should().BeNull();
        (await EditAsync(repo, chain, FarmA, Plain, AppRole.PrimaryOwner)).Should().Be(ShramSafalErrors.Forbidden);
        (await PublishAsync(repo, chain, FarmA, Plain, AppRole.SecondaryOwner)).Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task The_owner_publishes_the_version_his_delegate_made_with_no_maker_check()
    {
        var repo = World();
        var v1 = OwnChain(repo, Owner, Owner);
        var v2 = v1.EditCopyOnWrite(Guid.NewGuid(), "नवं", null, new UserId(Delegate), Now);
        repo.Templates[v2.Id] = v2;

        v2.CreatedByUserId.Should().Be(new UserId(Delegate));
        v2.OwnerUserId.Should().Be(new UserId(Owner));
        (await PublishAsync(repo, v2, FarmA, Owner)).Should().BeNull();
        (await PublishAsync(repo, v2, FarmA, Delegate)).Should().BeNull();
    }

    [Fact]
    public async Task A_holder_typed_chain_is_the_owners_and_is_written_under_the_owners_farms()
    {
        // Q9 = 1: the owner owns a holder-typed chain; the version names the typist. The write rule reads the OWNER column, never the maker.
        var repo = World();
        var chain = OwnChain(repo, Owner, Delegate);

        chain.CreatedByUserId.Should().Be(new UserId(Delegate));
        (await EditAsync(repo, chain, FarmA, Owner)).Should().BeNull();
        (await EditAsync(repo, chain, FarmB, HolderB)).Should().BeNull();
        (await EditAsync(repo, chain, FarmA, Plain)).Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task A_person_who_does_not_work_on_any_of_his_farms_does_not_see_his_own_chain()
    {
        var repo = World();
        var chain = OwnChain(repo, Owner, Owner);

        (await EditAsync(repo, chain, FarmA, Outsider)).Should().Be(ShramSafalErrors.ScheduleTemplateNotFound, "answered like a made-up id (E4)");
        repo.AuthorityReads.Should().Be(0);
        repo.FarmReads.Should().Be(1, "only the outsider's own farm, read by the viewer to learn whose team he is on");
    }

    // ---- a Team chain that names no owner: R32 -----------------------------------------------------------------------

    [Fact]
    public async Task A_delegate_cannot_version_or_publish_the_owners_Team_chain_that_names_no_owner()
    {
        var repo = World();
        var chain = PlainTeam(repo, Owner);

        (await EditAsync(repo, chain, FarmA, Delegate, AppRole.SecondaryOwner)).Should().Be(ShramSafalErrors.Forbidden, "R32: the second path is gone");
        (await PublishAsync(repo, chain, FarmA, Delegate, AppRole.SecondaryOwner)).Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task The_owner_still_versions_and_publishes_his_chain_under_the_scope_role_gate()
    {
        var repo = World();
        var chain = PlainTeam(repo, Owner);

        (await EditAsync(repo, chain, FarmA, Owner, AppRole.PrimaryOwner)).Should().BeNull();
        (await PublishAsync(repo, chain, FarmA, Owner, AppRole.PrimaryOwner)).Should().BeNull();
        (await PublishAsync(repo, chain, null, Owner, AppRole.PrimaryOwner)).Should().BeNull("publish has always tolerated no farm named");
        (await EditAsync(repo, chain, null, Owner, AppRole.PrimaryOwner)).Should().Be(ShramSafalErrors.Forbidden, "an edit always needs the farm named");
        (await EditAsync(repo, chain, FarmA, Owner, AppRole.Worker)).Should().Be(ShramSafalErrors.Forbidden, "ScopeRoleGate still asks the author roles");
    }

    [Fact]
    public async Task A_Licensed_chain_keeps_its_stricter_roles()
    {
        var repo = World();
        var chain = PlainTeam(repo, Owner, TenantScope.Licensed);

        (await EditAsync(repo, chain, FarmA, Owner, AppRole.PrimaryOwner)).Should().BeNull();
        (await EditAsync(repo, chain, FarmA, Owner, AppRole.FpcTechnicalManager)).Should().Be(ShramSafalErrors.Forbidden);
    }

    // ---- Private and Public --------------------------------------------------------------------------------------

    [Fact]
    public async Task A_Private_schedule_is_its_owners_and_a_Public_one_is_nobodys()
    {
        var repo = World();
        var mine = PlainTeam(repo, Owner, TenantScope.Private);
        var pub = PlainTeam(repo, Owner, TenantScope.Public);

        (await EditAsync(repo, mine, null, Owner)).Should().BeNull();
        (await EditAsync(repo, mine, null, Delegate)).Should().Be(ShramSafalErrors.ScheduleTemplateNotFound);
        (await PublishAsync(repo, mine, null, Owner)).Should().BeNull();
        (await PublishAsync(repo, mine, null, Delegate)).Should().Be(ShramSafalErrors.Forbidden);
        (await EditAsync(repo, pub, FarmA, Owner, AppRole.PrimaryOwner)).Should().Be(ShramSafalErrors.Forbidden);
        (await PublishAsync(repo, pub, FarmA, Owner, AppRole.PrimaryOwner)).Should().Be(ShramSafalErrors.Forbidden);
    }

    // ---- clone INTO his own schedule: the order ------------------------------------------------------------------

    private static ScheduleTemplate CheckedPublic(Repo repo, string cropKey = "grape")
    {
        var source = ScheduleTemplate.Import(
            Guid.NewGuid(), "Grapes - University", ScheduleOwnerType.Institution, null, cropKey, new UserId(Outsider), TenantScope.Public, Now,
            [new("Pruning", 0, 40)], [new ImportedActivity("a", "Pruning", 0, 1, FrequencyMode.OneTime, 1)], out var problem)!;
        problem.Should().BeNull();
        repo.Templates[source.Id] = source;
        var approve = ScheduleCheck.Approve(source, source.Activities.Select(a => a.Id).ToList(), new UserId(Outsider), "चेकर", Now, out var checkProblem)!;
        checkProblem.Should().BeNull();
        repo.Checks.Add(approve);
        return source;
    }

    private static void Grows(Repo repo, Guid farm, string crop) =>
        repo.Seasons.Add(CropCycle.Create(Guid.NewGuid(), new FarmId(farm), Guid.NewGuid(), crop, "Vegetative", DateOnly.FromDateTime(Now), null, Now));

    private static Task<Error?> IntoOwnAsync(Repo repo, ScheduleTemplate source, Guid? farm, Guid caller, TenantScope scope = TenantScope.Team) =>
        ScheduleTemplateWriteGate.RefuseCloneIntoFarmOwnAsync(repo, source, farm, scope, caller, Now, CancellationToken.None);

    [Fact]
    public async Task Into_own_asks_the_farm_then_the_scope_then_the_gate_before_it_learns_anything_else()
    {
        var repo = World();
        var source = CheckedPublic(repo);
        Grows(repo, FarmA, "Grapes");

        (await IntoOwnAsync(repo, source, null, Owner)).Should().Be(ShramSafalErrors.Forbidden, "FarmId required");
        (await IntoOwnAsync(repo, source, FarmA, Owner, TenantScope.Private)).Should().Be(ShramSafalErrors.InvalidCommand);
        (await IntoOwnAsync(repo, source, FarmA, Owner, TenantScope.Licensed)).Should().Be(ShramSafalErrors.InvalidCommand);
        (await IntoOwnAsync(repo, source, FarmA, Plain)).Should().Be(ShramSafalErrors.Forbidden, "a seat without the authority");
        (await IntoOwnAsync(repo, source, FarmA, Outsider)).Should().Be(ShramSafalErrors.Forbidden);

        repo.CheckReads.Should().Be(0, "the gate refused before the source's check was read");
        repo.SeasonReads.Should().Be(0, "and before the farm's seasons were read (E4)");
    }

    [Fact]
    public async Task Into_own_needs_a_source_ShramSafal_has_checked_now()
    {
        var repo = World();
        Grows(repo, FarmA, "Grapes");
        var good = CheckedPublic(repo);
        var waiting = CheckedPublic(repo);
        repo.Checks.RemoveAll(c => c.ScheduleTemplateId == waiting.Id);
        var withdrawn = CheckedPublic(repo);
        repo.Checks.Add(ScheduleCheck.Withdraw(withdrawn, "मागे", new UserId(Outsider), "चेकर", Now.AddMinutes(5), out _)!);
        var thin = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes - thin", "Pruning", Now, new UserId(Outsider), TenantScope.Public);
        var teamRow = PlainTeam(repo, Owner);

        (await IntoOwnAsync(repo, good, FarmA, Owner)).Should().BeNull();
        foreach (var source in new[] { waiting, withdrawn, thin, teamRow })
        {
            (await IntoOwnAsync(repo, source, FarmA, Owner)).Should().Be(ShramSafalErrors.ScheduleNotChecked, source.Name);
        }
    }

    [Fact]
    public async Task Into_own_needs_a_crop_the_farm_grows_in_any_season()
    {
        var repo = World();
        var onion = CheckedPublic(repo, "onion");
        var grape = CheckedPublic(repo, "grape");
        Grows(repo, FarmB, "Onion"); // another farm grows onion: not this one

        (await IntoOwnAsync(repo, onion, FarmA, Owner)).Should().Be(ShramSafalErrors.ScheduleCropNotOnFarm);
        (await IntoOwnAsync(repo, grape, FarmA, Owner)).Should().Be(ShramSafalErrors.ScheduleCropNotOnFarm);

        Grows(repo, FarmA, "Grapes");
        (await IntoOwnAsync(repo, grape, FarmA, Owner)).Should().BeNull("the phone's crop code: 'grape' and 'Grapes' are one crop");
        (await IntoOwnAsync(repo, onion, FarmA, Owner)).Should().Be(ShramSafalErrors.ScheduleCropNotOnFarm);
    }

    [Fact]
    public async Task FarmGrows_never_counts_an_unknown_crop()
    {
        var repo = World();
        Grows(repo, FarmA, "Zzzz");

        (await ScheduleTemplateWriteGate.FarmGrowsAsync(repo, FarmA, "Zzzz", CancellationToken.None)).Should().BeFalse();
        (await ScheduleTemplateWriteGate.FarmGrowsAsync(repo, FarmA, "", CancellationToken.None)).Should().BeFalse();
        (await ScheduleTemplateWriteGate.FarmGrowsAsync(repo, FarmA, null, CancellationToken.None)).Should().BeFalse();
    }
}

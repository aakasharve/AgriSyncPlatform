// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1)
//
// Handler tests for GetFarmContactsHandler, written by the test-writer from the
// plan only. The contract (Task 1 Interfaces, Global Constraints):
//   - platform owners only; a refused caller reads nothing (no factory opened)
//   - 1 to 200 comma-separated uuids, otherwise refused as invalid input,
//     with nothing read
//   - the repository is asked once, naming the signed-in admin (the audit row)
//     and exactly the ids asked for; unknown ids are left out by the repository
//   - failures escape (no catch that answers an empty list)
// A recording repository; no database.

using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class GetFarmContactsHandlerTests
{
    private static readonly Guid AdminUser = Guid.Parse("99999999-0000-0000-0000-0000000c2e01");

    private static Guid Farm(int n) => Guid.Parse($"c2e10000-0000-0000-0000-{n:D12}");

    [Fact]
    public async Task A_non_platform_admin_is_refused_and_nothing_is_read()
    {
        var repository = new RecordingMisRepository();
        var handler = new GetFarmContactsHandler(repository);

        var result = await handler.HandleAsync(
            new GetFarmContactsQuery(Ids(Farm(1), Farm(2)), AdminUser, IsPlatformAdmin: false));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden);
        repository.ContactCalls.Should().Be(0, "no farm name or phone is read, and no factory opened, for a refused caller");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(",")]
    public async Task Zero_ids_are_refused_and_nothing_is_read(string? ids)
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository)
            .HandleAsync(new GetFarmContactsQuery(ids, AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeFalse("zero ids is not a request for contacts (1 to 200 ids)");
        result.Error.Kind.Should().Be(ErrorKind.Validation);
        repository.ContactCalls.Should().Be(0);
    }

    [Fact]
    public async Task More_than_200_ids_are_refused_and_nothing_is_read()
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository).HandleAsync(new GetFarmContactsQuery(
            Ids(Enumerable.Range(1, 201).Select(Farm).ToArray()), AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeFalse("at most 200 ids");
        result.Error.Kind.Should().Be(ErrorKind.Validation);
        repository.ContactCalls.Should().Be(0);
    }

    [Fact]
    public async Task An_id_that_is_not_a_uuid_is_refused_and_nothing_is_read()
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository).HandleAsync(new GetFarmContactsQuery(
            $"{Farm(1):D},x'; drop table y", AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeFalse("ids are comma-separated uuids");
        result.Error.Kind.Should().Be(ErrorKind.Validation);
        repository.ContactCalls.Should().Be(0);
    }

    [Fact]
    public async Task Exactly_200_ids_are_read_once_naming_the_admin()
    {
        var repository = new RecordingMisRepository();
        var asked = Enumerable.Range(1, 200).Select(Farm).ToArray();

        var result = await new GetFarmContactsHandler(repository)
            .HandleAsync(new GetFarmContactsQuery(Ids(asked), AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue("200 ids is inside the 1 to 200 rule");
        repository.ContactCalls.Should().Be(1, "one read, so one factory open and one audit row per batch");
        repository.AdminUserId.Should().Be(AdminUser, "the signed-in admin is named in the cross-farm audit row");
        repository.AskedIds.Should().BeEquivalentTo(asked);
    }

    [Fact]
    public async Task One_id_is_read_and_the_repository_answer_is_returned()
    {
        var repository = new RecordingMisRepository();

        var result = await new GetFarmContactsHandler(repository)
            .HandleAsync(new GetFarmContactsQuery(Farm(7).ToString("D"), AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue();
        repository.AskedIds.Should().Equal(Farm(7));
        result.Value.Should().BeEquivalentTo(new[]
        {
            new FarmContactDto(Farm(7), "Fake Farm 7", "0000000007", Guid.Parse("a0000000-0000-0000-0000-000000000007")),
        });
    }

    [Fact]
    public async Task Unknown_ids_are_left_out_not_invented()
    {
        // The repository knows farm 1 only; farm 2 does not exist.
        var repository = new RecordingMisRepository(known: Farm(1));

        var result = await new GetFarmContactsHandler(repository).HandleAsync(
            new GetFarmContactsQuery(Ids(Farm(1), Farm(2)), AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Select(c => c.FarmId).Should().Equal(new[] { Farm(1) },
            "an unknown id is left out of the answer, never answered with a blank name");
    }

    [Fact]
    public async Task A_failing_read_escapes_never_an_empty_list()
    {
        var repository = new RecordingMisRepository { Throw = true };

        var act = () => new GetFarmContactsHandler(repository)
            .HandleAsync(new GetFarmContactsQuery(Ids(Farm(1)), AdminUser, IsPlatformAdmin: true));

        await act.Should().ThrowAsync<InvalidOperationException>(
            "a reader exception answers 500, never empty data (Global Constraints)");
    }

    private static string Ids(params Guid[] ids) => string.Join(",", ids.Select(i => i.ToString("D")));

    private sealed class RecordingMisRepository(params Guid[] known) : IAdminMisRepository
    {
        public int ContactCalls { get; private set; }
        public Guid? AdminUserId { get; private set; }
        public IReadOnlyCollection<Guid> AskedIds { get; private set; } = Array.Empty<Guid>();
        public bool Throw { get; init; }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        {
            ContactCalls++;
            AdminUserId = adminUserId;
            AskedIds = farmIds.ToArray();
            if (Throw)
            {
                throw new InvalidOperationException("fake read failure");
            }

            var answer = farmIds
                .Where(id => known.Length == 0 || known.Contains(id))
                .Select(id =>
                {
                    var n = int.Parse(id.ToString("D")[^12..]);
                    return new FarmContactDto(id, $"Fake Farm {n}", $"{n:D10}",
                        Guid.Parse($"a0000000-0000-0000-0000-{n:D12}"));
                })
                .ToList();
            return Task.FromResult<IReadOnlyList<FarmContactDto>>(answer);
        }

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}

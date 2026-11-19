// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S2; founder D-146; follow-up to lane SCH-ID-S)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Pictures;
using ShramSafal.Domain.Pictures;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>
/// Two first-time uploads for one subject at once: both find no row, both stage an insert, and the second save meets the one-row-per-subject
/// unique index. The store tells the handler it lost (<c>TrySaveNewAsync</c> answers false); the handler must re-read the winner and answer
/// 200 from the normal replace rules, leave one row, and leave no orphaned file.
/// </summary>
public sealed class FirstUploadRaceTests
{
    private static readonly Guid Owner = Guid.NewGuid();

    private readonly PictureRepo _repo = new();
    private readonly MemoryStorage _storage = new();

    private SetPictureHandler Set(MemoryPictureStore store) =>
        new(_repo, store, _storage, new FixedClock(PictureTestKit.Now), NullLogger<SetPictureHandler>.Instance);

    private static SetPictureCommand Put(byte[] bytes) =>
        new(PictureKind.Person, null, new MemoryStream(bytes), Owner, "1.0.17", "device-1", "sha256:ip");

    /// <summary>The first request's row, as it stands in the database when the second request's insert is refused.</summary>
    private Picture WinnerWith(byte[] bytes)
    {
        var winner = Picture.Create(
            Guid.NewGuid(), PictureKind.Person, Owner, PictureRules.Jpeg, bytes.Length, PictureRules.Sha256Hex(bytes), new UserId(Owner), PictureTestKit.Now.AddSeconds(-1));
        _storage.Files[winner.StorageKey] = bytes; // the winner wrote its file before its row
        return winner;
    }

    [Fact]
    public async Task The_same_file_lost_race_answers_200_from_the_winner_keeps_one_row_one_file_and_writes_no_audit_row()
    {
        var bytes = PictureTestKit.Jpeg(300);
        var winner = WinnerWith(bytes);
        var store = new LostFirstSaveRaceStore(_repo, winner);

        var result = await Set(store).HandleAsync(Put(bytes));

        result.IsSuccess.Should().BeTrue("the loser is not an error: both requests answer 200");
        result.Value!.Id.Should().Be(winner.Id, "the answer is the winner's row");
        result.Value.Sha256.Should().Be(winner.Sha256);
        store.Rows.Should().ContainSingle().Which.Should().BeSameAs(winner);
        store.SaveAttempts.Should().Be(1, "the first-picture save ran once, lost, and was not retried");
        _repo.Saves.Should().Be(0, "nothing is changed: the same file again is a no-op");
        _repo.Audits.Should().BeEmpty("a no-op writes no audit row, and the loser's doomed first attempt was discarded with its row");

        // Same bytes = same key: the file the loser wrote IS the winner's file. It is kept, and it is the only file there is.
        _storage.Files.Keys.Should().Equal(winner.StorageKey);
        _storage.Files[winner.StorageKey].Should().Equal(bytes);
    }

    [Fact]
    public async Task A_different_file_lost_race_replaces_the_winners_row_deletes_the_winners_file_and_orphans_nothing()
    {
        var winnerBytes = PictureTestKit.Jpeg(300, fill: 1);
        var loserBytes = PictureTestKit.Png(400);
        var winner = WinnerWith(winnerBytes);
        var winnerKey = winner.StorageKey;
        var store = new LostFirstSaveRaceStore(_repo, winner);

        var result = await Set(store).HandleAsync(Put(loserBytes));

        result.IsSuccess.Should().BeTrue();
        var loserSha = PictureRules.Sha256Hex(loserBytes);
        var row = store.Rows.Should().ContainSingle("exactly one row exists").Subject;
        row.Should().BeSameAs(winner, "the winner's row is updated, not duplicated");
        row.Sha256.Should().Be(loserSha);
        row.ContentType.Should().Be("image/png");
        row.Bytes.Should().Be(loserBytes.Length);
        result.Value!.Sha256.Should().Be(loserSha);
        result.Value.Id.Should().Be(winner.Id);

        // the row's file is there; the replaced (winner's) file is deleted; nothing else is left behind
        _storage.Files.Keys.Should().Equal(row.StorageKey);
        _storage.Files[row.StorageKey].Should().Equal(loserBytes);
        _storage.Files.Should().NotContainKey(winnerKey);
        _storage.Deleted.Should().Contain(winnerKey);

        // the winner's own audit row is the other request's; this one adds exactly its own, truthfully a replace
        var audit = _repo.Audits.Should().ContainSingle("the discarded first attempt left no audit row behind").Subject;
        audit.Action.Should().Be("PictureSet");
        audit.EntityId.Should().Be(winner.Id);
        audit.Payload.Should().Contain("\"replaced\":true").And.Contain(loserSha);
        _repo.Saves.Should().Be(1, "the replace is an ordinary save");
    }

    [Fact]
    public async Task A_different_file_lost_race_still_answers_200_when_the_storage_refuses_to_delete_the_winners_file()
    {
        var winner = WinnerWith(PictureTestKit.Jpeg(300, fill: 1));
        _storage.FailDeleteOf.Add(winner.StorageKey);
        var loserBytes = PictureTestKit.Webp(120);
        var store = new LostFirstSaveRaceStore(_repo, winner);

        var result = await Set(store).HandleAsync(Put(loserBytes));

        result.IsSuccess.Should().BeTrue("a failed delete of the replaced file never fails a save that has happened");
        store.Rows.Should().ContainSingle().Which.Sha256.Should().Be(PictureRules.Sha256Hex(loserBytes));
        _storage.Files.Should().ContainKey(store.Rows[0].StorageKey);
    }

    [Fact]
    public async Task When_the_winner_was_removed_again_before_the_re_read_the_request_makes_the_first_row_itself()
    {
        var bytes = PictureTestKit.Jpeg(200);
        var store = new LostFirstSaveRaceStore(_repo, winner: null);

        var result = await Set(store).HandleAsync(Put(bytes));

        result.IsSuccess.Should().BeTrue();
        var row = store.Rows.Should().ContainSingle().Subject;
        row.Sha256.Should().Be(PictureRules.Sha256Hex(bytes));
        _storage.Files.Keys.Should().Equal(row.StorageKey);
        var audit = _repo.Audits.Should().ContainSingle().Subject;
        audit.Payload.Should().Contain("\"replaced\":false");
        _repo.Saves.Should().Be(1, "the second go is an ordinary save: a second lost race there is a real fault and is not hidden");
    }

    [Fact]
    public async Task A_save_that_fails_for_any_other_reason_is_not_swallowed()
    {
        var store = new ThrowingFirstSaveStore();

        var act = () => Set(store).HandleAsync(Put(PictureTestKit.Jpeg(100)));

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("some other fault");
    }

    [Fact]
    public async Task Without_a_race_the_first_upload_still_saves_once_through_the_store()
    {
        var store = new MemoryPictureStore();

        var result = await Set(store).HandleAsync(Put(PictureTestKit.Jpeg(100)));

        result.IsSuccess.Should().BeTrue();
        store.Saves.Should().Be(1);
        _repo.Saves.Should().Be(0);
        _repo.Audits.Should().ContainSingle().Which.Payload.Should().Contain("\"replaced\":false");
    }

    /// <summary>
    /// The unique index refuses the first save: the other request's row appears (<paramref name="winner"/>; none when it was removed again) and
    /// what this request staged (its row and its audit row) is discarded, as the EF store detaches it. The next save succeeds.
    /// </summary>
    private sealed class LostFirstSaveRaceStore(PictureRepo repo, Picture? winner) : MemoryPictureStore
    {
        public int SaveAttempts { get; private set; }

        public override Task<bool> TrySaveNewAsync(CancellationToken ct = default)
        {
            SaveAttempts++;
            if (SaveAttempts > 1)
            {
                return base.TrySaveNewAsync(ct);
            }

            Rows.Clear();
            repo.Audits.Clear();
            if (winner is not null)
            {
                Rows.Add(winner);
            }

            return Task.FromResult(false);
        }
    }

    private sealed class ThrowingFirstSaveStore : MemoryPictureStore
    {
        public override Task<bool> TrySaveNewAsync(CancellationToken ct = default) =>
            throw new InvalidOperationException("some other fault");
    }
}

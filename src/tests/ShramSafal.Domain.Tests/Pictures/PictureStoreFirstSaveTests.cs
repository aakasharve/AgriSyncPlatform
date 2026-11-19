// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S2; founder D-146; follow-up to lane SCH-ID-S)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using ShramSafal.Domain.Pictures;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Domain.Tests.Pictures;

/// <summary>
/// <see cref="PictureStore.TrySaveNewAsync"/> catches ONE failure: the one-row-per-subject unique index refusing the insert. No database is
/// touched: the context is on the Npgsql provider but an interceptor throws as the save starts, before EF opens a connection. (The savepoint
/// and the real index are proved on a real Postgres by <c>PictureFirstUploadRaceRealPostgresTests</c>, which the orchestrator runs.)
/// </summary>
public sealed class PictureStoreFirstSaveTests
{
    private static readonly Guid Person = Guid.NewGuid();

    private static PostgresException Violation(string sqlState, string? constraint) =>
        new("boom", "ERROR", "ERROR", sqlState, constraintName: constraint);

    private static ShramSafalDbContext ContextWhoseSaveFailsWith(Exception failure) =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=never_opened;Username=none;Password=none")
            .AddInterceptors(new FailTheSave(failure))
            .Options);

    private static Picture NewPicture()
    {
        var bytes = PictureTestKit.Jpeg(64);
        return Picture.Create(
            Guid.NewGuid(), PictureKind.Person, Person, PictureRules.Jpeg, bytes.Length, PictureRules.Sha256Hex(bytes), new UserId(Person), PictureTestKit.Now);
    }

    [Fact]
    public async Task The_kind_subject_unique_index_answers_false_and_discards_everything_staged()
    {
        await using var db = ContextWhoseSaveFailsWith(new DbUpdateException("save failed", Violation("23505", PictureStore.KindSubjectIndex)));
        var store = new PictureStore(db);
        store.Stage(NewPicture());
        db.ChangeTracker.Entries().Should().ContainSingle("the row is staged");

        var saved = await store.TrySaveNewAsync();

        saved.Should().BeFalse("another request made the first picture of this subject");
        db.ChangeTracker.Entries().Should().BeEmpty("nothing of the doomed attempt can be replayed by a later save");
    }

    [Fact]
    public async Task The_index_name_is_the_one_the_table_really_has()
    {
        // the catch names the index; if the configuration renames it the catch would silently stop matching
        await using var db = ContextWhoseSaveFailsWith(new InvalidOperationException("unused"));
        var index = db.Model.FindEntityType(typeof(Picture))!.GetIndexes().Single(i => i.IsUnique && i.Properties.Count == 2);

        index.GetDatabaseName().Should().Be(PictureStore.KindSubjectIndex);
        index.Properties.Select(p => p.Name).Should().BeEquivalentTo(nameof(Picture.Kind), nameof(Picture.SubjectId));
    }

    [Theory]
    [InlineData("23505", "PK_pictures")]          // the row id is taken: not this race
    [InlineData("23505", "ix_pictures_set_by")]   // some other index
    [InlineData("23505", null)]                   // a unique violation that names nothing
    [InlineData("23514", PictureStore.KindSubjectIndex)] // right name, not a unique violation (a check constraint)
    [InlineData("42501", PictureStore.KindSubjectIndex)] // row security refused the write
    [InlineData("40001", null)]                   // serialization failure
    public async Task Any_other_database_failure_is_thrown_not_swallowed_and_nothing_is_detached(string sqlState, string? constraint)
    {
        var failure = new DbUpdateException("save failed", Violation(sqlState, constraint));
        await using var db = ContextWhoseSaveFailsWith(failure);
        var store = new PictureStore(db);
        store.Stage(NewPicture());

        var act = () => store.TrySaveNewAsync();

        (await act.Should().ThrowAsync<DbUpdateException>()).Which.Should().BeSameAs(failure);
        db.ChangeTracker.Entries().Should().ContainSingle("a failure that is not the race leaves the unit as it was");
    }

    [Fact]
    public async Task A_failure_that_is_not_a_database_update_error_is_thrown()
    {
        await using var db = ContextWhoseSaveFailsWith(new InvalidOperationException("not a DbUpdateException"));
        var store = new PictureStore(db);
        store.Stage(NewPicture());

        var act = () => store.TrySaveNewAsync();

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("not a DbUpdateException");
    }

    private sealed class FailTheSave(Exception failure) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            throw failure;
    }
}

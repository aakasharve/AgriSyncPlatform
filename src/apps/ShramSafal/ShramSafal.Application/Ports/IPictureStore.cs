using ShramSafal.Domain.Pictures;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146). <c>ssf.pictures</c>: the current picture of a person or a
/// schedule. A separate port (not <see cref="IShramSafalRepository"/>, F7: a new member there touches 28 implementors); the Infrastructure store
/// shares the repository's DbContext, so a staged row is saved by the caller's one <see cref="IShramSafalRepository.SaveChangesAsync"/> together
/// with its audit row.
///
/// <para><b>Row security.</b> Writes pass only under the setter's own user scope (the table's policies, migration <c>AddPictures</c>). Reads
/// are open to every user scope BY DESIGN (a picture is read by other people than the one who set it): WHO may see a row is the application's
/// rule (<c>PictureViewer</c>), asked by every door that serves one.</para>
/// </summary>
public interface IPictureStore
{
    /// <summary>The current picture of one subject, TRACKED (so a replace updates it), or <c>null</c>.</summary>
    Task<Picture?> GetAsync(PictureKind kind, Guid subjectId, CancellationToken ct = default);

    /// <summary>One picture by id (read-only), or <c>null</c>.</summary>
    Task<Picture?> GetByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>The current pictures of these subjects of one kind (read-only). One read, whatever the number of subjects.</summary>
    Task<IReadOnlyList<Picture>> GetManyAsync(PictureKind kind, IReadOnlyCollection<Guid> subjectIds, CancellationToken ct = default);

    /// <summary>Stages a new row; the caller saves.</summary>
    void Stage(Picture picture);

    /// <summary>Stages the deletion of a row; the caller saves.</summary>
    void Remove(Picture picture);
}

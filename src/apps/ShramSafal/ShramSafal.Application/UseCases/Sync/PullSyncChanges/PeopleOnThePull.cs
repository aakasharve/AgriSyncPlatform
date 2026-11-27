using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S3; P11, P1, P8). The people rows of the pull (<c>operators</c>).
///
/// <list type="bullet">
/// <item><b>A phone that asks</b> (<c>people=1</c>) gets, on each row it already receives, the person's name in Marathi and in English letters as HE
/// saved them on his own identity card (<c>nameMr</c> / <c>nameEn</c>; only a name he typed or confirmed is ever stored, never a machine
/// suggestion), and the pointer to his face (<c>pictureId</c> + <c>pictureSha256</c>) only when <see cref="PictureViewer"/> says this reader may
/// see it. Each new field is LEFT OUT when there is nothing to say.</item>
/// <item><b>Every other phone</b> (1.0.17, today's test build) gets exactly the rows it got before this lane: the four fields are cleared, so they
/// are never written.</item>
/// </list>
/// Which ROWS are sent is unchanged (MU-3: a कामगार is sent no other person's row), so the names reach nobody who did not already get the person's
/// name; the photo rule decides the face alone.
/// </summary>
public static class PeopleOnThePull
{
    public static async Task<IReadOnlyList<SyncOperatorDto>> RowsAsync(
        bool asked,
        IReadOnlyList<SyncOperatorDto> operators,
        IShramSafalRepository repository,
        IPictureStore store,
        IFarmMateSeatReader mates,
        Guid readerUserId,
        IEnumerable<FarmReadScope> scopes,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(operators);
        if (!asked)
        {
            return operators.Select(Plain).ToList();
        }

        if (operators.Count == 0)
        {
            return [];
        }

        var faces = (await store.GetManyAsync(PictureKind.Person, operators.Select(o => o.UserId).Distinct().ToList(), ct))
            .GroupBy(p => p.SubjectId)
            .ToDictionary(g => g.Key, g => g.First());
        var viewer = faces.Count == 0 ? null : await PictureViewer.CreateAsync(repository, mates, readerUserId, scopes, ct);

        return operators
            .Select(o =>
            {
                var face = viewer is not null && faces.TryGetValue(o.UserId, out var picture) && viewer.MaySeePersonOf(o.UserId)
                    ? picture
                    : null;
                return o with
                {
                    NameMr = string.IsNullOrWhiteSpace(o.NameMr) ? null : o.NameMr,
                    NameEn = string.IsNullOrWhiteSpace(o.NameEn) ? null : o.NameEn,
                    PictureId = face?.Id,
                    PictureSha256 = face?.Sha256,
                };
            })
            .ToList();
    }

    /// <summary>The row exactly as a phone that did not ask received it before this lane.</summary>
    public static SyncOperatorDto Plain(SyncOperatorDto row) =>
        row with { NameMr = null, NameEn = null, PictureId = null, PictureSha256 = null };
}

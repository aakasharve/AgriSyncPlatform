using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Application.UseCases.Pictures;

public sealed record GetPictureFileQuery(Guid PictureId, Guid RequestedByUserId);

/// <summary>The file, its type and its hash (the ETag). The stream belongs to the caller.</summary>
public sealed record GetPictureFileResult(Guid PictureId, string ContentType, string Sha256, Stream ContentStream);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146). One picture's file, served by id after
/// <see cref="PictureViewer"/> says this person may see it. A made-up id, a face he may not see and a schedule he may not see all answer
/// <see cref="ShramSafalErrors.PictureNotFound"/> (E4). Server-streamed: no presigned link (the attachment pattern).
/// </summary>
public sealed class GetPictureFileHandler(
    IShramSafalRepository repository,
    IPictureStore store,
    IAttachmentStorageService storage,
    IClock clock,
    // spec: plr-d10 pilot lane IDENT (S3) - the Active seats of his farms: a farm-mate's face is his to see.
    IFarmMateSeatReader mates)
{
    public async Task<Result<GetPictureFileResult>> HandleAsync(GetPictureFileQuery query, CancellationToken ct = default)
    {
        if (query.PictureId == Guid.Empty || query.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<GetPictureFileResult>(ShramSafalErrors.PictureNotFound);
        }

        var picture = await store.GetByIdAsync(query.PictureId, ct);
        if (picture is null)
        {
            return Result.Failure<GetPictureFileResult>(ShramSafalErrors.PictureNotFound);
        }

        // A logo is for everyone: no farm needs to be read for it.
        IReadOnlyList<FarmReadScope> scopes = picture.Kind == PictureKind.Institution
            ? []
            : await PictureViewer.ScopesOfAsync(repository, query.RequestedByUserId, clock.UtcNow, ct);
        var viewer = await PictureViewer.CreateAsync(repository, mates, query.RequestedByUserId, scopes, ct);
        if (!await viewer.MaySeeAsync(picture, ct))
        {
            return Result.Failure<GetPictureFileResult>(ShramSafalErrors.PictureNotFound);
        }

        var stream = await storage.OpenReadAsync(picture.StorageKey, ct);
        return stream is null
            ? Result.Failure<GetPictureFileResult>(ShramSafalErrors.PictureNotFound)
            : Result.Success(new GetPictureFileResult(picture.Id, picture.ContentType, picture.Sha256, stream));
    }
}

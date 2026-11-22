namespace ShramSafal.Application.Contracts.Dtos;

// spec: plr-d10 lane GRP-1a - GroupName is the LAST positional parameter, defaulting to null: a payload that never had it
// (an older server, a cached copy) reads as "no group". It is read-only here; the create_plot sync payload never carries it.
public sealed record PlotDto(
    Guid Id,
    Guid FarmId,
    string Name,
    decimal AreaInAcres,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    string? GroupName = null);

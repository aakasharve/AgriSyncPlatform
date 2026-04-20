namespace ShramSafal.Application.Contracts.Dtos;

public sealed record LocationDto(
    decimal Latitude,
    decimal Longitude,
    decimal AccuracyMeters,
    decimal? Altitude,
    DateTime CapturedAtUtc,
    string Provider,
    string PermissionState);

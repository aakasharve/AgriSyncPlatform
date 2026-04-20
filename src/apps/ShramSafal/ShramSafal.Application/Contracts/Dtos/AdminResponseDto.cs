namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Wrapper that every admin endpoint returns.
/// Frontend <DataFreshnessChip> reads Source + LastRefreshedUtc.
/// </summary>
public sealed record AdminResponseDto<T>(
    T Data,
    AdminMetaDto Meta);

public sealed record AdminMetaDto(
    /// <summary>live | live-aggregated | materialized</summary>
    string Source,
    string Window,
    DateTime LastRefreshedUtc,
    int TtlSeconds);

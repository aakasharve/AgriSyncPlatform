namespace AgriSync.SharedKernel.Contracts.CommonDtos;

public sealed record PagedResult<T>(
    IReadOnlyList<T> Items,
    int TotalCount,
    int PageNumber,
    int PageSize)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);

    public bool HasPreviousPage => PageNumber > 1;

    public bool HasNextPage => PageNumber < TotalPages;

    public static PagedResult<T> Empty(int pageNumber = PageRequest.DefaultPageNumber, int pageSize = PageRequest.DefaultPageSize) =>
        new([], 0, pageNumber, pageSize);
}

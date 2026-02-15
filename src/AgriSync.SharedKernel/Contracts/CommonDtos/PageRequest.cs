namespace AgriSync.SharedKernel.Contracts.CommonDtos;

public sealed record PageRequest
{
    public const int DefaultPageNumber = 1;
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 500;

    private int _pageNumber = DefaultPageNumber;
    private int _pageSize = DefaultPageSize;

    public int PageNumber
    {
        get => _pageNumber;
        init => _pageNumber = value < DefaultPageNumber ? DefaultPageNumber : value;
    }

    public int PageSize
    {
        get => _pageSize;
        init => _pageSize = value switch
        {
            <= 0 => DefaultPageSize,
            > MaxPageSize => MaxPageSize,
            _ => value
        };
    }

    public int Skip => (PageNumber - 1) * PageSize;
}

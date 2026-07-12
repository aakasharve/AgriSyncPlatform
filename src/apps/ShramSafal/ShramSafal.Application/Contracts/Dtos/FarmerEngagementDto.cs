namespace ShramSafal.Application.Contracts.Dtos;

// System.Text.Json serializes these PascalCase props as camelCase by default,
// yielding { currentStreak, longestStreak, totalShramPoints, lastAccountedDate,
// totalRichDays, unlockStatus }. unlockStatus is the lowercase "locked"/"unlocked"
// string folded by FarmerEngagementProjection. LastAccountedDate is an ISO
// yyyy-MM-dd string (or null) so the wire shape stays date-library agnostic.
public sealed record FarmerEngagementDto(
    int CurrentStreak,
    int LongestStreak,
    int TotalShramPoints,
    string? LastAccountedDate,
    int TotalRichDays,
    string UnlockStatus);

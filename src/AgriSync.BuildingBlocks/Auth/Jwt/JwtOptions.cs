namespace AgriSync.BuildingBlocks.Auth.Jwt;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; init; } = "AgriSync";

    public string Audience { get; init; } = "AgriSync.Clients";

    public string SigningKey { get; init; } = "CHANGE_ME_IN_CONFIGURATION";

    public int AccessTokenMinutes { get; init; } = 60;
}

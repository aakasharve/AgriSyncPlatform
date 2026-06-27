namespace User.Api.Endpoints;

public sealed record AuthResponseBody(Guid UserId, string AccessToken, DateTime ExpiresAtUtc);

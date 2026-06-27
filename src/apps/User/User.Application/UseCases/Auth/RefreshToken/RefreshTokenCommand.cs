using User.Application.UseCases.Auth.Session;

namespace User.Application.UseCases.Auth.RefreshToken;

public sealed record RefreshTokenCommand(string RefreshToken, DeviceSessionRequest Session);

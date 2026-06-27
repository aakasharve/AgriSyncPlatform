namespace User.Application.UseCases.Auth.Session;

public sealed record DeviceSessionRequest(
    string DeviceId,
    bool RememberDevice,
    string? DeviceName,
    string Platform);

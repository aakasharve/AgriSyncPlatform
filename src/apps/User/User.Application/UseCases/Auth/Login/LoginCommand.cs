using User.Application.UseCases.Auth.Session;

namespace User.Application.UseCases.Auth.Login;

public sealed record LoginCommand(string Phone, string Password, DeviceSessionRequest Session);

namespace User.Application.UseCases.Auth.Login;

public sealed record LoginCommand(string Phone, string Password);

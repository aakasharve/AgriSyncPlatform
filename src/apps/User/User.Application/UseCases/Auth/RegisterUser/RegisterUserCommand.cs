namespace User.Application.UseCases.Auth.RegisterUser;

public sealed record RegisterUserCommand(
    string Phone,
    string Password,
    string DisplayName,
    string? AppId = "shramsafal",
    string? Role = "PrimaryOwner");

using User.Application.UseCases.Auth.Session;

namespace User.Application.UseCases.Auth.RegisterUser;

/// <param name="Role">spec I19 — carried ONLY so a request that tries to choose an account role is
/// refused (<c>auth.register_role_not_allowed</c>). It is never applied: a password-registered
/// account gets no app membership, exactly like an SMS-registered one, so its role resolves to the
/// plain default (Worker).</param>
public sealed record RegisterUserCommand(
    string Phone,
    string Password,
    string DisplayName,
    string? Role = null,
    DeviceSessionRequest? Session = null);

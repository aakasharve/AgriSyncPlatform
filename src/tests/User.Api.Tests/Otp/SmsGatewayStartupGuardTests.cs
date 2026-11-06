using FluentAssertions;
using User.Infrastructure.Otp;
using Xunit;

namespace User.Api.Tests.Otp;

/// <summary>
/// Production must refuse to boot on the dev SMS stub or with an empty MSG91
/// key/template. Non-production environments are never blocked.
///
/// spec: otp-msg91-go-live-2026-10-21
/// </summary>
public sealed class SmsGatewayStartupGuardTests
{
    private static Msg91Options Configured() => new()
    {
        UseDevStub = false,
        AuthKey = "test-auth-key",
        TemplateId = "test-template-id",
    };

    [Fact]
    public void Production_with_full_msg91_config_passes()
    {
        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(true, Configured());

        act.Should().NotThrow();
    }

    [Fact]
    public void Production_with_default_options_fails_because_stub_is_the_default()
    {
        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(true, new Msg91Options());

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*UseDevStub*")
            .WithMessage("*AuthKey*")
            .WithMessage("*TemplateId*");
    }

    [Fact]
    public void Production_with_stub_enabled_fails_even_when_keys_are_set()
    {
        var options = Configured();
        options.UseDevStub = true;

        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(true, options);

        act.Should().Throw<InvalidOperationException>().WithMessage("*UseDevStub*");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("OVERRIDE_VIA_ENVIRONMENT_VARIABLE")]
    public void Production_with_blank_or_placeholder_auth_key_fails(string authKey)
    {
        var options = Configured();
        options.AuthKey = authKey;

        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(true, options);

        act.Should().Throw<InvalidOperationException>().WithMessage("*AuthKey*");
    }

    [Theory]
    [InlineData("")]
    [InlineData("OVERRIDE_VIA_ENVIRONMENT_VARIABLE")]
    public void Production_with_blank_or_placeholder_template_fails(string templateId)
    {
        var options = Configured();
        options.TemplateId = templateId;

        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(true, options);

        act.Should().Throw<InvalidOperationException>().WithMessage("*TemplateId*");
    }

    [Fact]
    public void Failure_message_never_contains_the_secret_values()
    {
        var options = Configured();
        options.UseDevStub = true;
        options.TemplateId = "";

        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(true, options);

        act.Should().Throw<InvalidOperationException>()
            .Which.Message.Should().NotContain("test-auth-key");
    }

    [Fact]
    public void Non_production_is_never_blocked_even_on_the_stub()
    {
        var act = () => SmsGatewayStartupGuard.EnsureSafeForEnvironment(false, new Msg91Options());

        act.Should().NotThrow();
    }
}

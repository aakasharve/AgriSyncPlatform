using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using User.Infrastructure.Otp;
using Xunit;

namespace User.Api.Tests.Otp;

/// <summary>
/// The request shape matches the curl that delivered a real SMS on 2026-11-01:
/// everything in the query string, empty JSON body, authkey header.
///
/// spec: otp-msg91-go-live-2026-10-21
/// </summary>
public sealed class Msg91SmsSenderTests
{
    private sealed class CapturingHandler(string responseJson) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent(responseJson),
            };
        }
    }

    private static Msg91SmsSender Create(CapturingHandler handler) => new(
        new HttpClient(handler),
        Options.Create(new Msg91Options
        {
            UseDevStub = false,
            AuthKey = "test-auth-key",
            TemplateId = "tmpl123",
            OtpLength = 6,
            OtpExpiryMinutes = 5,
        }),
        NullLogger<Msg91SmsSender>.Instance);

    [Fact]
    public async Task Sends_query_string_with_empty_json_body_and_authkey_header()
    {
        var handler = new CapturingHandler("""{"request_id":"abc123","type":"success"}""");

        var result = await Create(handler).SendOtpAsync("919999999999", "123456");

        result.IsSuccess.Should().BeTrue();
        var receipt = result.Value!;
        receipt.ProviderRequestId.Should().Be("abc123");
        receipt.ProviderName.Should().Be("msg91");

        var request = handler.Request!;
        request.Method.Should().Be(HttpMethod.Post);
        request.RequestUri!.AbsoluteUri.Should().Be(
            "https://control.msg91.com/api/v5/otp?template_id=tmpl123&mobile=919999999999&otp=123456&otp_length=6&otp_expiry=5");
        request.Headers.GetValues("authkey").Should().ContainSingle().Which.Should().Be("test-auth-key");
        request.Content!.Headers.ContentType!.MediaType.Should().Be("application/json");
        handler.Body.Should().Be("{}");
    }

    [Fact]
    public async Task Provider_error_type_is_a_failure()
    {
        var handler = new CapturingHandler("""{"type":"error","message":"template not found"}""");

        var result = await Create(handler).SendOtpAsync("919999999999", "123456");

        result.IsSuccess.Should().BeFalse();
    }
}

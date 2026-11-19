// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S2; founder D-146; follow-up to lane SCH-ID-S)
//
// HTTP status codes of ShramSafal.Api/Endpoints/PictureEndpoints.cs, through the real route table and the real handlers.
// NO database and NO Docker: the EF InMemory provider and a temp-folder file store, the same file-local harness the repo's other endpoint tests
// carry (LabourEndpointTests.TestHarness). Row security, the savepoint and the unique index are NOT exercised here (InMemory has none): those
// are proved on a real Postgres by PicturesRealPostgresTests and PictureFirstUploadRaceRealPostgresTests.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Domain.Pictures;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Pictures;

public sealed class PictureEndpointsTests
{
    private static readonly Guid Anna = Guid.Parse("a0a0a0a0-1111-4111-8111-000000000001");
    private static readonly Guid Ben = Guid.Parse("a0a0a0a0-2222-4222-8222-000000000002");

    // The type is decided from the first bytes: a tiny but valid JPEG head and a PNG head.
    private static byte[] Jpeg(int size = 200, byte fill = 7)
    {
        var bytes = new byte[size];
        new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }.CopyTo(bytes, 0);
        Array.Fill(bytes, fill, 4, size - 4);
        return bytes;
    }

    // ---- the refusals ----------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_file_of_the_wrong_kind_is_400_unsupported_type_whatever_it_is_called()
    {
        await using var harness = await TestHarness.CreateAsync();

        // an SVG that says it is a JPEG: the first bytes decide, never the header or a name
        var svg = "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>"u8.ToArray();
        var response = await harness.PutAsync("/shramsafal/pictures/person", svg, Anna, "image/jpeg");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ErrorCodeAsync(response)).Should().Be("ShramSafal.Picture.UnsupportedType");
        harness.Files().Should().BeEmpty("a refused file is never stored");
    }

    [Fact]
    public async Task An_empty_body_is_400_empty()
    {
        await using var harness = await TestHarness.CreateAsync();

        var response = await harness.PutAsync("/shramsafal/pictures/person", [], Anna, "image/jpeg");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ErrorCodeAsync(response)).Should().Be("ShramSafal.Picture.Empty");
    }

    [Fact]
    public async Task A_file_over_512_KB_is_413_and_one_at_exactly_512_KB_is_accepted()
    {
        await using var harness = await TestHarness.CreateAsync();

        var tooLarge = await harness.PutAsync("/shramsafal/pictures/person", Jpeg(PictureRules.MaxBytes + 1), Anna, "image/jpeg");
        var atTheCap = await harness.PutAsync("/shramsafal/pictures/person", Jpeg(PictureRules.MaxBytes), Anna, "image/jpeg");

        tooLarge.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await ErrorCodeAsync(tooLarge)).Should().Be("ShramSafal.Picture.TooLarge");
        atTheCap.StatusCode.Should().Be(HttpStatusCode.OK, "the cap is on the size over the line, not at it");
    }

    [Fact]
    public async Task Without_a_token_every_picture_route_is_401_and_nothing_is_written()
    {
        await using var harness = await TestHarness.CreateAsync();
        var schedule = Guid.NewGuid();

        var put = await harness.PutAsync("/shramsafal/pictures/person", Jpeg(), caller: null, "image/jpeg");
        var putSchedule = await harness.PutAsync($"/shramsafal/pictures/schedule/{schedule}", Jpeg(), caller: null, "image/jpeg");
        var delete = await harness.Client.DeleteAsync("/shramsafal/pictures/person");
        var get = await harness.Client.GetAsync($"/shramsafal/pictures/{Guid.NewGuid()}");

        put.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        putSchedule.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        delete.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        get.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        harness.Files().Should().BeEmpty();
        (await harness.PictureCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task An_unknown_picture_id_is_404()
    {
        await using var harness = await TestHarness.CreateAsync();

        var response = await harness.GetAsync($"/shramsafal/pictures/{Guid.NewGuid()}", Anna);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ErrorCodeAsync(response)).Should().Be("ShramSafal.PictureNotFound");
    }

    [Fact]
    public async Task A_schedule_that_does_not_exist_is_404_not_a_server_error()
    {
        await using var harness = await TestHarness.CreateAsync();

        var response = await harness.PutAsync($"/shramsafal/pictures/schedule/{Guid.NewGuid()}", Jpeg(), Anna, "image/jpeg");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ErrorCodeAsync(response)).Should().Be("ShramSafal.ScheduleTemplateNotFound");
    }

    // ---- the happy path and the cache headers ----------------------------------------------------------------------------

    [Fact]
    public async Task A_person_sets_his_picture_then_reads_it_back_with_an_etag_and_a_matching_if_none_match_is_304()
    {
        await using var harness = await TestHarness.CreateAsync();
        var bytes = Jpeg(300);

        var put = await harness.PutAsync("/shramsafal/pictures/person", bytes, Anna, "image/jpeg");

        put.StatusCode.Should().Be(HttpStatusCode.OK);
        using var row = JsonDocument.Parse(await put.Content.ReadAsStringAsync());
        var id = row.RootElement.GetProperty("id").GetGuid();
        var sha = row.RootElement.GetProperty("sha256").GetString()!;
        row.RootElement.GetProperty("kind").GetString().Should().Be("PERSON");
        row.RootElement.GetProperty("subjectId").GetGuid().Should().Be(Anna);
        row.RootElement.GetProperty("contentType").GetString().Should().Be("image/jpeg");
        row.RootElement.GetProperty("bytes").GetInt32().Should().Be(300);
        row.RootElement.TryGetProperty("content", out _).Should().BeFalse("the file is never echoed");

        var get = await harness.GetAsync($"/shramsafal/pictures/{id}", Anna);

        get.StatusCode.Should().Be(HttpStatusCode.OK);
        get.Content.Headers.ContentType!.MediaType.Should().Be("image/jpeg");
        (await get.Content.ReadAsByteArrayAsync()).Should().Equal(bytes);
        get.Headers.ETag!.Tag.Should().Be("\"" + sha + "\"", "the ETag is the file's own hash, quoted");
        get.Headers.CacheControl!.Private.Should().BeTrue("a person's face is never kept by a shared cache");

        var revalidate = await harness.GetAsync($"/shramsafal/pictures/{id}", Anna, ifNoneMatch: "\"" + sha + "\"");

        revalidate.StatusCode.Should().Be(HttpStatusCode.NotModified);
        (await revalidate.Content.ReadAsByteArrayAsync()).Should().BeEmpty("a 304 carries no body");

        var stale = await harness.GetAsync($"/shramsafal/pictures/{id}", Anna, ifNoneMatch: "\"" + new string('0', 64) + "\"");
        stale.StatusCode.Should().Be(HttpStatusCode.OK, "an ETag that is not the file's own gets the file");
    }

    [Fact]
    public async Task Another_person_asking_for_the_picture_of_someone_he_does_not_work_with_is_404_not_403()
    {
        await using var harness = await TestHarness.CreateAsync();
        var put = await harness.PutAsync("/shramsafal/pictures/person", Jpeg(), Anna, "image/jpeg");
        using var row = JsonDocument.Parse(await put.Content.ReadAsStringAsync());
        var id = row.RootElement.GetProperty("id").GetGuid();

        var asStranger = await harness.GetAsync($"/shramsafal/pictures/{id}", Ben);

        asStranger.StatusCode.Should().Be(HttpStatusCode.NotFound, "a face he may not see answers like one that does not exist (E4)");
    }

    [Fact]
    public async Task The_same_file_again_is_200_with_the_same_row_and_a_delete_is_204_twice()
    {
        await using var harness = await TestHarness.CreateAsync();
        var bytes = Jpeg(250);

        var first = await harness.PutAsync("/shramsafal/pictures/person", bytes, Anna, "image/jpeg");
        var again = await harness.PutAsync("/shramsafal/pictures/person", bytes, Anna, "image/jpeg");

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        again.StatusCode.Should().Be(HttpStatusCode.OK);
        (await first.Content.ReadAsStringAsync()).Should().Be(await again.Content.ReadAsStringAsync(), "a no-op answers the same row");
        (await harness.PictureCountAsync()).Should().Be(1);

        var delete = await harness.SendAsync(HttpMethod.Delete, "/shramsafal/pictures/person", Anna);
        var deleteAgain = await harness.SendAsync(HttpMethod.Delete, "/shramsafal/pictures/person", Anna);

        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        deleteAgain.StatusCode.Should().Be(HttpStatusCode.NoContent, "204 whether or not a picture existed");
        (await harness.PictureCountAsync()).Should().Be(0);
    }

    private static async Task<string?> ErrorCodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("error").GetString();
    }

    // ---- harness (file-local, like LabourEndpointTests; InMemory EF, no database, no Docker) ------------------------------------

    private sealed class TestHarness(WebApplication app, HttpClient client, string storageDirectory) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();
            var storageDirectory = Path.Combine(Path.GetTempPath(), "agrisync-picture-endpoint-tests", Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // never opened: the DbContext below is InMemory
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDirectory,
            });

            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            builder.Services.AddAnalytics(options => options.UseInMemoryDatabase($"picture-tests-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"picture-tests-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options => options.UseInMemoryDatabase(dbName, dbRoot));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            return new TestHarness(app, app.GetTestClient(), storageDirectory);
        }

        public Task<HttpResponseMessage> PutAsync(string uri, byte[] body, Guid? caller, string contentType)
        {
            var request = new HttpRequestMessage(HttpMethod.Put, uri) { Content = new ByteArrayContent(body) };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            return Send(request, caller);
        }

        public Task<HttpResponseMessage> GetAsync(string uri, Guid? caller, string? ifNoneMatch = null)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, uri);
            if (ifNoneMatch is not null)
            {
                request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
            }

            return Send(request, caller);
        }

        public Task<HttpResponseMessage> SendAsync(HttpMethod method, string uri, Guid? caller) => Send(new HttpRequestMessage(method, uri), caller);

        private Task<HttpResponseMessage> Send(HttpRequestMessage request, Guid? caller)
        {
            if (caller is { } user)
            {
                request.Headers.Add("X-Test-UserId", user.ToString());
            }

            return Client.SendAsync(request);
        }

        /// <summary>The files the server stored under this harness's folder (empty when it has stored none).</summary>
        public string[] Files() =>
            Directory.Exists(storageDirectory) ? Directory.GetFiles(storageDirectory, "*", SearchOption.AllDirectories) : [];

        public async Task<int> PictureCountAsync()
        {
            await using var scope = app.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>().Pictures.CountAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
            if (Directory.Exists(storageDirectory))
            {
                Directory.Delete(storageDirectory, recursive: true);
            }
        }
    }

    /// <summary>Signs in the caller named by <c>X-Test-UserId</c>; no header means nobody is signed in (the route answers 401).</summary>
    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-UserId", out var header) || !Guid.TryParse(header, out var userId))
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            var identity = new ClaimsIdentity([new Claim("sub", userId.ToString())], Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
        }
    }
}

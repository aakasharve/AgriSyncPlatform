// spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a; asked for by the independent review of 2026-11-14).
//
// THE APP'S FAILURE-REPORT DOOR REFUSES VERY LARGE BODIES.
//
// POST /telemetry/client-error is anonymous. It binds its body as any JSON value and stores that value, whole, as the
// props of a client.error row in analytics.events, a table that is append-only and never cleaned. Until this change
// the only limit on that body was the server's 50 MB limit for every request, so anybody could add 50 MB to that table
// ten times a minute from one address.
//
// The rule these tests hold:
//   - a body larger than 64 KB (65,536 bytes) is answered 413 and nothing is written;
//   - a body of ordinary size is still answered 204 and written exactly as before.
//
// WHY THIS CLASS STARTS THE REAL SERVER. The route is written inline in Program.cs. No test host in this repository
// can mount it: every in-process harness maps a module's own Map...() method, and the one harness that builds the real
// host (ServerRouteTableTests, `--list-routes`) exits before it serves. And the limit must be judged on the real web
// server: the in-memory test server does not apply a request-size limit declared on a route, so a correct
// implementation would fail there and a test written for it would force the code to get worse. So this class does what
// ServerRouteTableTests does, one step further: it runs the built Bootstrapper as a child process and lets it serve on
// a loopback port, configured the way .github/workflows/e2e.yml starts the same server (environment "CI", every
// connection string given explicitly). It is the first test in the repository to do that.
//
// WHAT IT NEEDS. A THROWAWAY Postgres, named by REQUIRES_POSTGRES_ROOT_CONN (the variable every RequiresPostgres class
// in this project reads), whose user may create a database and roles, as in CI. The class creates an empty database of
// its own there, points the child at it (the server applies every migration itself when it starts, which is most of
// the time this class takes) and drops it afterwards. With the variable unset every test FAILS with the reason; it
// never passes without having run. The server cannot serve without a database: it migrates before it listens, and its
// background services stop the host when they cannot connect.
//
// WHAT THE CHILD CAN REACH. Only that database. Its content root is an empty folder holding a copy of the tracked
// appsettings.json and nothing else, so no local appsettings and no secrets file are read; every ConnectionStrings__*
// variable it would inherit is overwritten; the switches that turn on Secrets Manager, metric publishing and the demo
// seeders are removed from its environment.
//
// HOW TO TELL A BROKEN HARNESS FROM THE MISSING RULE. A harness problem throws from the class fixture, so all four
// tests fail with one and the same message: "RequiresPostgres: ..." when no throwaway database is configured or
// reachable, "HARNESS: ..." (with the server's last log lines) when the server did not start. When the harness works,
// the first test below is a control that passes before the rule exists, and the other three fail before it exists
// with "expected ... RequestEntityTooLarge ... but found NoContent".
//
// A test run that is killed from outside can leave the child running and its database behind (the database's name
// begins "ssf_reportdoor_"). Stop that process and drop that database by hand.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using FluentAssertions.Execution;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Contract;

[Trait("Category", "RequiresPostgres")]
public sealed class ClientErrorReportDoorTests(ClientErrorReportDoorTests.ServedHost host, ITestOutputHelper output)
    : IClassFixture<ClientErrorReportDoorTests.ServedHost>, IDisposable
{
    private const string Route = "/telemetry/client-error";

    /// <summary>64 KB. A body of this many bytes is accepted; one byte more is refused.</summary>
    private const int LargestAcceptedBodyBytes = 65_536;

    /// <summary>The server's own log, after each test, so a failure can be read without a second run.</summary>
    public void Dispose() => output.WriteLine(host.LogTail());

    // ------------------------------------------------------------------
    // The control: what the door did before, it still does
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_body_of_ordinary_size_is_answered_204_and_written_as_before()
    {
        var marker = NewMarker();

        // What the app's failure reporter posts when a request fails, and one key to find the row by.
        var body = Ascii(
            "{\"type\":\"api_failure\",\"endpoint\":\"/sync/push\",\"statusCode\":500,\"marker\":\"" + marker + "\"}");
        var before = await host.ClientErrorRowCountAsync();

        using var response = await host.PostAsync(Route, WithDeclaredLength(body));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent,
            "an ordinary failure report is accepted exactly as before: the released app expects 204 (P11)");

        var rows = await host.ClientErrorRowsMarkedAsync(marker);
        rows.Should().ContainSingle("the report is written, once");

        var row = rows[0];
        row.HasActor.Should().BeFalse("the door is anonymous: the row names nobody");
        row.HasFarm.Should().BeFalse("no farm claim came with the request");
        row.ActorRole.Should().Be("client");
        row.Trigger.Should().Be("browser");
        row.SchemaVersion.Should().Be("v1");

        // The props are the caller's body: these four keys and no other.
        using var props = JsonDocument.Parse(row.PropsJson);
        props.RootElement.ValueKind.Should().Be(JsonValueKind.Object);
        props.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            new[] { "type", "endpoint", "statusCode", "marker" });
        props.RootElement.GetProperty("type").GetString().Should().Be("api_failure");
        props.RootElement.GetProperty("endpoint").GetString().Should().Be("/sync/push");
        props.RootElement.GetProperty("statusCode").GetInt32().Should().Be(500);
        props.RootElement.GetProperty("marker").GetString().Should().Be(marker);

        (await host.ClientErrorRowCountAsync()).Should().Be(before + 1, "one report, one row");
    }

    // ------------------------------------------------------------------
    // The rule
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_body_larger_than_64_KB_is_answered_413_and_nothing_is_written()
    {
        var marker = NewMarker();
        var body = BodyOfExactly(70_000, marker);
        var before = await host.ClientErrorRowCountAsync();

        using var response = await host.PostAsync(Route, WithDeclaredLength(body));

        var rowsHoldingIt = await host.RowsHoldingAsync(marker);
        var after = await host.ClientErrorRowCountAsync();

        using (new AssertionScope())
        {
            response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge,
                "a 70,000-byte body is larger than 64 KB (65,536 bytes): the door answers 413, it does "
                + "not accept whatever the server's 50 MB limit allows");
            rowsHoldingIt.Should().Be(0,
                "nothing of a refused body is kept: no row of any type in analytics.events holds it");
            after.Should().Be(before, "a refused report writes no client.error row");
        }
    }

    [Fact]
    public async Task The_limit_is_65536_bytes_that_many_are_accepted_and_one_more_is_refused()
    {
        var atTheLimit = NewMarker();
        var oneMore = NewMarker();
        var before = await host.ClientErrorRowCountAsync();

        using var accepted = await host.PostAsync(
            Route, WithDeclaredLength(BodyOfExactly(LargestAcceptedBodyBytes, atTheLimit)));
        using var refused = await host.PostAsync(
            Route, WithDeclaredLength(BodyOfExactly(LargestAcceptedBodyBytes + 1, oneMore)));

        var rowsAtTheLimit = await host.RowsHoldingAsync(atTheLimit);
        var rowsOneMore = await host.RowsHoldingAsync(oneMore);
        var after = await host.ClientErrorRowCountAsync();

        using (new AssertionScope())
        {
            accepted.StatusCode.Should().Be(HttpStatusCode.NoContent,
                "a body of exactly 65,536 bytes is not larger than 64 KB: it is accepted");
            rowsAtTheLimit.Should().Be(1, "and it is written");

            refused.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge,
                "a body of 65,537 bytes is larger than 64 KB: it is refused");
            rowsOneMore.Should().Be(0, "and nothing of it is kept");

            after.Should().Be(before + 1, "of the two reports, one was written");
        }
    }

    [Fact]
    public async Task A_large_body_that_does_not_declare_its_length_is_refused_too()
    {
        var marker = NewMarker();
        var body = BodyOfExactly(70_000, marker);
        var before = await host.ClientErrorRowCountAsync();

        // No Content-Length: the body is sent in chunks. A rule that only read the declared length
        // would let this one through, and the door is open to anybody who knows that.
        using var content = new LengthlessContent(body);
        using var request = new HttpRequestMessage(HttpMethod.Post, Route) { Content = content };
        request.Headers.TransferEncodingChunked = true;

        using var response = await host.SendAsync(request);

        var rowsHoldingIt = await host.RowsHoldingAsync(marker);
        var after = await host.ClientErrorRowCountAsync();

        using (new AssertionScope())
        {
            content.Headers.ContentLength.Should().BeNull("this request is the one that declares no length");
            response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge,
                "the limit is on the body that arrives, not on the length its sender chose to declare");
            rowsHoldingIt.Should().Be(0, "nothing of a refused body is kept");
            after.Should().Be(before, "a refused report writes no client.error row");
        }
    }

    // ------------------------------------------------------------------
    // Bodies
    // ------------------------------------------------------------------

    /// <summary>Letters and digits only: safe inside JSON text and inside a LIKE pattern.</summary>
    private static string NewMarker() => "door" + Guid.NewGuid().ToString("N");

    private static byte[] Ascii(string text) => Encoding.ASCII.GetBytes(text);

    /// <summary>
    /// A well-formed failure report of exactly <paramref name="bytes"/> bytes: the keys the app sends, the marker, and a
    /// message padded to size. Well-formed on purpose, so the only thing wrong with a large one is its size.
    /// </summary>
    private static byte[] BodyOfExactly(int bytes, string marker)
    {
        var head = "{\"type\":\"api_failure\",\"endpoint\":\"/sync/push\",\"statusCode\":500,\"marker\":\""
            + marker + "\",\"message\":\"";
        const string tail = "\"}";
        var padding = bytes - head.Length - tail.Length;
        padding.Should().BeGreaterThan(0, "HARNESS: the body asked for is smaller than its own keys");

        var body = Ascii(head + new string('a', padding) + tail);
        body.Length.Should().Be(bytes, "HARNESS: the body must be exactly the size the test names");
        using (var parsed = JsonDocument.Parse(body))
        {
            parsed.RootElement.GetProperty("marker").GetString().Should().Be(marker, "HARNESS: the body must be valid JSON");
        }

        return body;
    }

    private static ByteArrayContent WithDeclaredLength(byte[] body)
    {
        var content = new ByteArrayContent(body);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return content;
    }

    /// <summary>A JSON body whose length is not known before it is sent, so it travels chunked.</summary>
    private sealed class LengthlessContent : HttpContent
    {
        private readonly byte[] _body;

        public LengthlessContent(byte[] body)
        {
            _body = body;
            Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            stream.WriteAsync(_body, 0, _body.Length);

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }

    /// <summary>One client.error row, as the door wrote it.</summary>
    public sealed record WrittenReport(
        bool HasActor, bool HasFarm, string ActorRole, string Trigger, string SchemaVersion, string PropsJson);

    // ------------------------------------------------------------------
    // The real server, served once for the whole class
    // ------------------------------------------------------------------

    /// <summary>
    /// The built Bootstrapper as a child process, serving on a loopback port against a database of its own. Started
    /// once for the class: the door allows ten reports a minute from one address, and the four tests send five.
    /// </summary>
    public sealed class ServedHost : IAsyncLifetime
    {
        /// <summary>Starting includes applying every migration to an empty database. e2e.yml allows 60 s on CI.</summary>
        private static readonly TimeSpan ReadyWithin = TimeSpan.FromSeconds(240);

        private readonly object _logLock = new();
        private readonly Queue<string> _log = new();

        private string _rootConn = string.Empty;
        private string _scratchDbName = string.Empty;
        private string _scratchConn = string.Empty;
        private string _work = string.Empty;
        private Process? _process;
        private HttpClient? _client;

        public async Task InitializeAsync()
        {
            try
            {
                // Throws, with the reason, when no throwaway Postgres is configured or it cannot be reached.
                _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

                var name = $"ssf_reportdoor_{Guid.NewGuid():N}";
                await using (var admin = new NpgsqlConnection(_rootConn))
                {
                    await admin.OpenAsync();
                    await using var create = admin.CreateCommand();
                    create.CommandText = $"CREATE DATABASE \"{name}\"";
                    await create.ExecuteNonQueryAsync();
                }

                _scratchDbName = name;
                _scratchConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = name }.ConnectionString;

                // The database is left EMPTY on purpose. The server migrates it itself when it starts, exactly as it
                // does in e2e.yml. (IntegrationMigrationChain is not used here: it records User, Accounts and
                // ShramSafal migrations in EF's default history table, while the server's own registration reads
                // "__ef_migrations", so the server would take a database migrated that way for an unmigrated one and
                // apply everything twice.)
                var port = FreeLoopbackPort();
                _process = StartBootstrapper(port);
                _client = new HttpClient
                {
                    BaseAddress = new Uri($"http://127.0.0.1:{port}"),
                    Timeout = TimeSpan.FromSeconds(60),
                };

                await WaitUntilReadyAsync();
            }
            catch
            {
                // A start that failed half-way must not leave a server running or a database behind.
                await DisposeAsync();
                throw;
            }
        }

        /// <summary>Stops the server, removes its folder and drops its database. Safe to call twice.</summary>
        public async Task DisposeAsync()
        {
            _client?.Dispose();
            _client = null;

            if (_process is { } process)
            {
                _process = null;
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                        await process.WaitForExitAsync();
                    }
                }
                catch
                {
                    // Best-effort: teardown must never hide the test's own result.
                }

                process.Dispose();
            }

            if (!string.IsNullOrEmpty(_work))
            {
                try { Directory.Delete(_work, recursive: true); }
                catch (IOException) { /* a leftover temp folder is harmless; the next run uses a new one */ }
                catch (UnauthorizedAccessException) { /* the same */ }
                _work = string.Empty;
            }

            if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_rootConn))
            {
                return;
            }

            var scratch = _scratchDbName;
            _scratchDbName = string.Empty;

            try
            {
                NpgsqlConnection.ClearAllPools();
                await using var admin = new NpgsqlConnection(_rootConn);
                await admin.OpenAsync();

                await using (var terminate = admin.CreateCommand())
                {
                    terminate.CommandText =
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                    terminate.Parameters.AddWithValue("db", scratch);
                    await terminate.ExecuteNonQueryAsync();
                }

                await using var drop = admin.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{scratch}\"";
                await drop.ExecuteNonQueryAsync();
            }
            catch
            {
                // Best-effort teardown; a leaked scratch database on a throwaway server is harmless.
            }
        }

        // -------------------------- requests --------------------------

        public Task<HttpResponseMessage> PostAsync(string route, HttpContent content) => Client.PostAsync(route, content);

        public Task<HttpResponseMessage> SendAsync(HttpRequestMessage request) => Client.SendAsync(request);

        private HttpClient Client =>
            _client ?? throw new InvalidOperationException("HARNESS: the server was not started.");

        // -------------------------- what was written --------------------------

        public async Task<long> ClientErrorRowCountAsync() =>
            await ScalarAsync("SELECT count(*) FROM analytics.events WHERE event_type = 'client.error'");

        /// <summary>Rows of ANY type whose props hold the marker, anywhere in them.</summary>
        public async Task<long> RowsHoldingAsync(string marker) =>
            await ScalarAsync(
                "SELECT count(*) FROM analytics.events WHERE props::text LIKE '%' || @marker || '%'",
                ("marker", marker));

        public async Task<IReadOnlyList<WrittenReport>> ClientErrorRowsMarkedAsync(string marker)
        {
            await using var conn = new NpgsqlConnection(_scratchConn);
            await conn.OpenAsync();

            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                """
                SELECT actor_user_id IS NOT NULL, farm_id IS NOT NULL, actor_role, trigger, schema_version, props::text
                FROM analytics.events
                WHERE event_type = 'client.error'
                  AND props::text LIKE '%' || @marker || '%'
                """;
            cmd.Parameters.AddWithValue("marker", marker);

            var rows = new List<WrittenReport>();
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                rows.Add(new WrittenReport(
                    HasActor: reader.GetBoolean(0),
                    HasFarm: reader.GetBoolean(1),
                    ActorRole: reader.GetString(2),
                    Trigger: reader.GetString(3),
                    SchemaVersion: reader.GetString(4),
                    PropsJson: reader.GetString(5)));
            }

            return rows;
        }

        private async Task<long> ScalarAsync(string sql, params (string Name, object Value)[] parameters)
        {
            await using var conn = new NpgsqlConnection(_scratchConn);
            await conn.OpenAsync();

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
            {
                cmd.Parameters.AddWithValue(name, value);
            }

            return Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        // -------------------------- the child process --------------------------

        public string LogTail()
        {
            lock (_logLock)
            {
                return "[REPORT-DOOR] the server's last lines:\n" + string.Join('\n', _log);
            }
        }

        private void Keep(string? line)
        {
            if (line is null)
            {
                return;
            }

            lock (_logLock)
            {
                _log.Enqueue(line);
                while (_log.Count > 120)
                {
                    _log.Dequeue();
                }
            }
        }

        private Process StartBootstrapper(int port)
        {
            var bootstrapper = typeof(RouteTableCommand).Assembly.Location;
            var settings = Path.Combine(Path.GetDirectoryName(bootstrapper)!, "appsettings.json");
            if (!File.Exists(settings))
            {
                throw new InvalidOperationException(
                    $"HARNESS: the Bootstrapper's tracked appsettings.json was not found beside {bootstrapper}.");
            }

            // An empty content root holding the tracked defaults and nothing else: no appsettings.Development.json,
            // no secrets/local/credentials.json.
            _work = Path.Combine(Path.GetTempPath(), $"agrisync-report-door-{Guid.NewGuid():N}");
            Directory.CreateDirectory(_work);
            File.Copy(settings, Path.Combine(_work, "appsettings.json"));

            var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
            {
                WorkingDirectory = _work,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            foreach (var arg in new[]
            {
                bootstrapper,
                "--environment", "CI",
                "--contentRoot", _work,
                "--urls", $"http://127.0.0.1:{port}",
            })
            {
                start.ArgumentList.Add(arg);
            }

            var env = start.Environment;

            // The child reaches the scratch database and no other: every connection name it could inherit, and every
            // name the host knows, is this one.
            foreach (var inherited in env.Keys
                         .Where(k => k.StartsWith("ConnectionStrings__", StringComparison.OrdinalIgnoreCase))
                         .ToList())
            {
                env[inherited] = _scratchConn;
            }

            foreach (var name in new[]
                     {
                         "UserDb", "UserDb_Migration", "UserDb_ReadOnly",
                         "ShramSafalDb", "ShramSafalDb_Migration", "ShramSafalDb_ReadOnly",
                         "AccountsDb", "AnalyticsDb",
                     })
            {
                env[$"ConnectionStrings__{name}"] = _scratchConn;
            }

            // Switches a developer's machine may carry. None of them belongs in this server.
            foreach (var name in new[]
                     {
                         "USE_SECRETS_MANAGER", "AGRISYNC_PUBLISH_METRICS", "ALLOW_E2E_SEED",
                         "SEED_BLANK_TEST_USER", "SEED_TEST_PROTOCOLS_V1", "SEED_PURVESH_DEMO", "CLEAR_PURVESH_DEMO",
                         "ASPNETCORE_URLS", "DOTNET_URLS", "URLS", "ASPNETCORE_HTTPS_PORT", "HTTPS_PORT",
                         "REQUIRES_POSTGRES_ROOT_CONN", "ADMIN_TESTS_ADMIN_ROOT_CONN",
                     })
            {
                env.Remove(name);
            }

            // As .github/workflows/e2e.yml starts this server. None of these values is a secret.
            env["ASPNETCORE_ENVIRONMENT"] = "CI";
            env["DOTNET_ENVIRONMENT"] = "CI";
            env["ALLOW_PRODUCTION_STARTUP_MIGRATIONS"] = "true";
            env["Jwt__SigningKey"] = "report-door-test-only-placeholder-signing-key-0000";
            env["Audit__IpHashSalt"] = Convert.ToBase64String(
                Encoding.ASCII.GetBytes("report-door-test-only-salt-not-a-secret-0123456789"));
            env["Cors__AllowedOrigins__0"] = "http://localhost:4173";
            env["OTel__Endpoint"] = string.Empty;

            var process = new Process { StartInfo = start };
            process.OutputDataReceived += (_, e) => Keep(e.Data);
            process.ErrorDataReceived += (_, e) => Keep(e.Data);

            if (!process.Start())
            {
                throw new InvalidOperationException("HARNESS: the Bootstrapper process could not be started.");
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        private async Task WaitUntilReadyAsync()
        {
            var patience = Stopwatch.StartNew();
            var last = "no answer yet";

            while (patience.Elapsed < ReadyWithin)
            {
                if (_process!.HasExited)
                {
                    throw new InvalidOperationException(
                        $"HARNESS: the server exited with code {_process.ExitCode} before it was ready. "
                        + "This is not the report-door rule failing.\n" + LogTail());
                }

                try
                {
                    using var response = await Client.GetAsync("/health/ready");
                    if (response.StatusCode == HttpStatusCode.OK)
                    {
                        return;
                    }

                    last = $"/health/ready answered {(int)response.StatusCode}";
                }
                catch (HttpRequestException ex)
                {
                    last = ex.Message;
                }
                catch (TaskCanceledException ex)
                {
                    last = ex.Message;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(500));
            }

            throw new TimeoutException(
                $"HARNESS: the server was not ready within {ReadyWithin.TotalSeconds:N0} s ({last}). "
                + "This is not the report-door rule failing.\n" + LogTail());
        }

        private static int FreeLoopbackPort()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            try
            {
                return ((IPEndPoint)listener.LocalEndpoint).Port;
            }
            finally
            {
                listener.Stop();
            }
        }
    }
}

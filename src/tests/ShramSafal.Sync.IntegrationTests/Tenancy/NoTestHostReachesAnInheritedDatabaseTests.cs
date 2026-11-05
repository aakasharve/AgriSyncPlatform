// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 1 (review M4, register F103).
//
// No test host can ever reach a database it was not handed. On this PC the user environment names the founder's own
// :5433 database under six ConnectionStrings__* names, and the appsettings files copied into the test output name it
// too; a host built with WebApplication.CreateBuilder reads both. These facts prove the guard WITHOUT touching any
// database: each first checks WHERE a connection would go, and only a connection to the sentinel (a name that never
// resolves) is ever opened.
using System;
using System.Collections;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

public sealed class NoTestHostReachesAnInheritedDatabaseTests
{
    private const string SentinelHost = "no-database-configured.invalid";

    [Fact]
    public void Every_connection_string_this_test_process_inherits_is_the_fail_closed_sentinel()
    {
        var inherited = Environment.GetEnvironmentVariables().Cast<DictionaryEntry>()
            .Where(e => e.Key is string name && name.StartsWith("ConnectionStrings__", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(e => (string)e.Key, e => e.Value as string);

        inherited.Keys.Should().Contain(TestProcessConnectionGuard.KnownNames.Select(n => $"ConnectionStrings__{n}"),
            "each name the app knows is set, so it outranks the appsettings files in the test output");
        foreach (var (name, value) in inherited)
        {
            new NpgsqlConnectionStringBuilder(value).Host.Should().Be(SentinelHost,
                $"{name} must not name any real database in a test process (it named this PC's own database before)");
        }
    }

    [Fact]
    public async Task A_host_built_like_the_test_hosts_that_names_no_database_fails_closed_instead_of_reaching_one()
    {
        // Exactly how the test hosts build: CreateBuilder, the Testing environment, the test output as content root
        // (so appsettings.json from the host project is read), environment variables included.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        var configuration = builder.Configuration;

        foreach (var name in TestProcessConnectionGuard.KnownNames)
        {
            var connection = configuration.GetConnectionString(name);
            connection.Should().NotBeNullOrWhiteSpace();
            new NpgsqlConnectionStringBuilder(connection).Host.Should().Be(SentinelHost,
                $"a host that does not name its own {name} must fall to the sentinel, never to an inherited or appsettings database");
        }

        // Checked above to be the sentinel, so this can only fail to resolve — it reaches no server at all.
        await using var probe = new NpgsqlConnection(configuration.GetConnectionString("ShramSafalDb_Migration"));
        var open = async () => await probe.OpenAsync();
        await open.Should().ThrowAsync<Exception>("a host given no database must fail, not connect somewhere");
    }

    [Fact]
    public void The_root_connection_has_no_appsettings_fallback_nothing_set_means_nothing_reached()
    {
        RequiresPostgresConnection.ResolveConfiguredOrNull(null).Should().BeNull(
            "with REQUIRES_POSTGRES_ROOT_CONN unset the suite must FAIL, never fall back to a developer's own database");
        RequiresPostgresConnection.ResolveConfiguredOrNull("   ").Should().BeNull();
        RequiresPostgresConnection.ResolveConfiguredOrNull("Host=127.0.0.1;Port=55590").Should().Be("Host=127.0.0.1;Port=55590");
    }
}

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Configuration;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Capacity;

/// <summary>
/// F36: every PostgreSQL connection string carries an explicit pool ceiling and explicit waits, set through the Npgsql
/// builder (so the cap is in the string Npgsql parses), an explicit operator value is never overridden, and a string
/// that cannot be parsed is reported rather than silently left uncapped.
/// </summary>
public sealed class ConnectionPoolCapTests
{
    private const string Base = "Host=db;Port=5432;Database=agrisync;Username=u;Password=p";

    [Fact]
    public void A_string_with_no_pool_settings_gets_the_cap_and_the_waits()
    {
        var tuned = ConnectionPoolDefaults.Apply(Base, 40, 15, 30, out var changed);

        Assert.True(changed);
        var parsed = new NpgsqlConnectionStringBuilder(tuned);
        Assert.Equal(40, parsed.MaxPoolSize);
        Assert.Equal(15, parsed.Timeout);
        Assert.Equal(30, parsed.CommandTimeout);
        Assert.Equal("db", parsed.Host);
    }

    [Fact]
    public void A_value_the_operator_wrote_is_never_overridden()
    {
        var tuned = ConnectionPoolDefaults.Apply(Base + ";Maximum Pool Size=12;Timeout=5;Command Timeout=90", 40, 15, 30, out var changed);

        Assert.False(changed);
        var parsed = new NpgsqlConnectionStringBuilder(tuned);
        Assert.Equal(12, parsed.MaxPoolSize);
        Assert.Equal(5, parsed.Timeout);
        Assert.Equal(90, parsed.CommandTimeout);
    }

    [Fact]
    public void Every_connection_string_in_configuration_is_capped_and_the_placeholder_is_reported()
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = Base,
            ["ConnectionStrings:ShramSafalDb_ReadOnly"] = Base + ";Maximum Pool Size=7",
            ["ConnectionStrings:UserDb_Migration"] = "OVERRIDE_VIA_ENVIRONMENT_VARIABLE",
            ["Database:MaxPoolSize"] = "25",
        });
        var warnings = new List<string>();

        var unparsable = ConnectionPoolDefaults.ApplyToConfiguration(configuration, warnings.Add);

        Assert.Equal(25, new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("UserDb")!).MaxPoolSize);
        Assert.Equal(7, new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("ShramSafalDb_ReadOnly")!).MaxPoolSize);
        Assert.Equal("OVERRIDE_VIA_ENVIRONMENT_VARIABLE", configuration.GetConnectionString("UserDb_Migration"));
        Assert.Equal(new[] { "UserDb_Migration" }, unparsable);
        Assert.Single(warnings);
    }
}

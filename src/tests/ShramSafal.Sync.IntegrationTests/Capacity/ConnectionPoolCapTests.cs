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
        var tuned = ConnectionPoolDefaults.Apply(Base, 40, 15, 30, "agrisync-x", out var changed);

        Assert.True(changed);
        var parsed = new NpgsqlConnectionStringBuilder(tuned);
        Assert.Equal(40, parsed.MaxPoolSize);
        Assert.Equal(15, parsed.Timeout);
        Assert.Equal(30, parsed.CommandTimeout);
        Assert.Equal("agrisync-x", parsed.ApplicationName);
        Assert.Equal("db", parsed.Host);
    }

    [Fact]
    public void A_value_the_operator_wrote_is_never_overridden()
    {
        var tuned = ConnectionPoolDefaults.Apply(Base + ";Maximum Pool Size=12;Timeout=5;Command Timeout=90;Application Name=mine", 40, 15, 30, "agrisync-x", out var changed);

        Assert.False(changed);
        var parsed = new NpgsqlConnectionStringBuilder(tuned);
        Assert.Equal(12, parsed.MaxPoolSize);
        Assert.Equal(5, parsed.Timeout);
        Assert.Equal(90, parsed.CommandTimeout);
        Assert.Equal("mine", parsed.ApplicationName);
    }

    [Fact]
    public void Every_connection_string_in_configuration_is_capped_and_the_placeholder_is_reported()
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = Base,
            ["ConnectionStrings:ShramSafalDb"] = Base,
            ["ConnectionStrings:ShramSafalDb_ReadOnly"] = Base + ";Maximum Pool Size=7",
            ["ConnectionStrings:UserDb_Migration"] = "OVERRIDE_VIA_ENVIRONMENT_VARIABLE",
            ["Database:MaxPoolSize"] = "25",
        });
        var warnings = new List<string>();

        var unparsable = ConnectionPoolDefaults.ApplyToConfiguration(configuration, warnings.Add);

        // writing keys take Database:MaxPoolSize; every other key takes the auxiliary default
        Assert.Equal(25, new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("UserDb")!).MaxPoolSize);
        Assert.Equal(25, new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("ShramSafalDb")!).MaxPoolSize);
        Assert.Equal("agrisync-UserDb", new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("UserDb")!).ApplicationName);
        Assert.Equal("agrisync-ShramSafalDb", new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("ShramSafalDb")!).ApplicationName);
        Assert.Equal(7, new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("ShramSafalDb_ReadOnly")!).MaxPoolSize);
        Assert.Equal("OVERRIDE_VIA_ENVIRONMENT_VARIABLE", configuration.GetConnectionString("UserDb_Migration"));
        Assert.Equal(new[] { "UserDb_Migration" }, unparsable);
        Assert.Single(warnings);
    }

    [Fact]
    public void Identical_text_under_two_keys_no_longer_shares_one_pool()
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = Base,
            ["ConnectionStrings:ShramSafalDb"] = Base,
            ["ConnectionStrings:AccountsDb"] = Base,
        });

        ConnectionPoolDefaults.ApplyToConfiguration(configuration, _ => { });

        var user = configuration.GetConnectionString("UserDb")!;
        var ssf = configuration.GetConnectionString("ShramSafalDb")!;
        var accounts = configuration.GetConnectionString("AccountsDb")!;
        Assert.NotEqual(user, ssf);
        Assert.NotEqual(user, accounts);
        Assert.Equal(ConnectionPoolDefaults.DefaultMaxPoolSize, new NpgsqlConnectionStringBuilder(ssf).MaxPoolSize);
        Assert.Equal(ConnectionPoolDefaults.DefaultAuxiliaryMaxPoolSize, new NpgsqlConnectionStringBuilder(accounts).MaxPoolSize);
    }
}

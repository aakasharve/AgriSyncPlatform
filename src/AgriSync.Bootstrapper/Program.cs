using System.Diagnostics;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Serilog;
using Serilog.Context;
using Accounts.Api;
using AgriSync.Bootstrapper.Endpoints;
using ShramSafal.Api;
using User.Api;
using User.Infrastructure.Persistence;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);
    builder.Configuration
        .AddJsonFile("secrets/local/credentials.json", optional: true, reloadOnChange: true)
        .AddEnvironmentVariables();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxRequestBodySize = 50L * 1024L * 1024L;
    });

    builder.Host.UseSerilog((context, services, loggerConfiguration) =>
    {
        loggerConfiguration
            .ReadFrom.Configuration(context.Configuration)
            .ReadFrom.Services(services)
            .Enrich.FromLogContext();
    });
    builder.Services.Configure<HostOptions>(options =>
    {
        options.ShutdownTimeout = TimeSpan.FromSeconds(30);
    });

    builder.Services.AddBuildingBlocks();
    builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
    builder.Services.AddProblemDetails();
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddRateLimiter(options =>
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.OnRejected = (rateLimitContext, _) =>
        {
            rateLimitContext.HttpContext.Response.Headers["Retry-After"] = "60";
            return ValueTask.CompletedTask;
        };

        options.AddPolicy("auth", httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: ResolveRemoteIpRateLimitPartitionKey(httpContext),
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 10,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                    AutoReplenishment = true
                }));

        options.AddPolicy("ai", httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: ResolveAiRateLimitPartitionKey(httpContext),
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 30,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                    AutoReplenishment = true
                }));
    });

    if (builder.Environment.IsDevelopment())
    {
        builder.Services.AddSwaggerGen();
    }

    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
    if (allowedOrigins.Length == 0)
    {
        throw new InvalidOperationException("Cors:AllowedOrigins must contain at least one configured origin.");
    }

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("AllowFrontend", policy =>
        {
            policy.WithOrigins(allowedOrigins)
                .WithHeaders("Content-Type", "Authorization", "X-Request-Id", "X-Device-Id")
                .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .AllowCredentials();
        });
    });

    builder.Services.AddUserApi(builder.Configuration);
    builder.Services.AddShramSafalApi(builder.Configuration);
    builder.Services.AddAccountsModule(builder.Configuration);

    var analyticsConnection =
        builder.Configuration.GetConnectionString("AnalyticsDb")
        ?? builder.Configuration.GetConnectionString("UserDb")
        ?? throw new InvalidOperationException(
            "Connection string 'AnalyticsDb' (or fallback 'UserDb') must be configured for the analytics event rail.");
    builder.Services.AddAnalytics(options =>
    {
        options.UseNpgsql(analyticsConnection, npgsql =>
        {
            // Migrations live in the Bootstrapper (which already references Npgsql)
            // so AgriSync.BuildingBlocks can stay provider-neutral.
            npgsql.MigrationsAssembly(typeof(Program).Assembly.FullName);
            npgsql.MigrationsHistoryTable(
                tableName: "__analytics_migrations_history",
                schema: AnalyticsDbContext.SchemaName);
        });
    });
    builder.Services.AddHostedService<AgriSync.Bootstrapper.Migrations.BackfillFarmOwnerAccounts>();
    builder.Services.AddHostedService<AgriSync.Bootstrapper.Jobs.MisRefreshJob>();
    builder.Services.AddHostedService<AgriSync.Bootstrapper.Jobs.SubscriptionReconciliationJob>();
    builder.Services.AddTransient<AgriSync.Bootstrapper.Infrastructure.DatabaseSeeder>();
    builder.Services.AddTransient<AgriSync.Bootstrapper.Infrastructure.PurveshDemoSeeder>();
    builder.Services.AddTransient<AgriSync.Bootstrapper.Infrastructure.BlankTestUserSeeder>();

    QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

    var app = builder.Build();

    app.UseForwardedHeaders(new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
    });
    app.Use(async (context, next) =>
    {
        var traceId = Activity.Current?.TraceId.ToString() ?? context.TraceIdentifier;
        var spanId = Activity.Current?.SpanId.ToString() ?? string.Empty;

        context.Response.Headers["X-Correlation-Id"] = context.TraceIdentifier;

        using (LogContext.PushProperty("CorrelationId", context.TraceIdentifier))
        using (LogContext.PushProperty("TraceId", traceId))
        using (LogContext.PushProperty("SpanId", spanId))
        {
            await next();
        }
    });
    app.UseSerilogRequestLogging(options =>
    {
        options.EnrichDiagnosticContext = (diagnosticContext, httpContext) =>
        {
            diagnosticContext.Set("CorrelationId", httpContext.TraceIdentifier);
            diagnosticContext.Set("TraceId", Activity.Current?.TraceId.ToString() ?? httpContext.TraceIdentifier);
            diagnosticContext.Set("SpanId", Activity.Current?.SpanId.ToString() ?? string.Empty);
            diagnosticContext.Set("ClientIp", httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown");
        };
    });
    app.UseExceptionHandler();
    if (!app.Environment.IsDevelopment())
    {
        app.UseHttpsRedirection();
    }

    app.UseCors("AllowFrontend");

    if (app.Environment.IsDevelopment())
    {
        ConfigureDevelopmentSwagger(app);
        // HARDENING: verified — these endpoints are unreachable in Production
        MapDevelopmentOnlyTestEndpoints(app);
    }

    app.UseAuthentication();
    app.UseRateLimiter();
    app.UseAuthorization();

    app.MapGet("/health", () =>
    {
        return Results.Ok(new
        {
            status = "healthy",
            service = "AgriSync"
        });
    })
    .WithName("GetBootstrapperHealth")
    .WithTags("System")
    .AllowAnonymous();

    app.MapGet("/health/ready", async (
        UserDbContext userDb,
        ShramSafal.Infrastructure.Persistence.ShramSafalDbContext ssfDb,
        ILoggerFactory loggerFactory,
        CancellationToken ct) =>
    {
        try
        {
            var userDbReady = await userDb.Database.CanConnectAsync(ct);
            var shramSafalDbReady = await ssfDb.Database.CanConnectAsync(ct);
            var ready = userDbReady && shramSafalDbReady;

            return ready
                ? Results.Ok(new
                {
                    status = "ready",
                    service = "AgriSync",
                    checks = new
                    {
                        userDb = "connected",
                        shramSafalDb = "connected"
                    }
                })
                : Results.Json(new
                {
                    status = "not_ready",
                    service = "AgriSync",
                    checks = new
                    {
                        userDb = userDbReady ? "connected" : "disconnected",
                        shramSafalDb = shramSafalDbReady ? "connected" : "disconnected"
                    }
                }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        catch (Exception ex)
        {
            loggerFactory
                .CreateLogger("AgriSync.Bootstrapper.Readiness")
                .LogError(ex, "Readiness check failed while probing database connectivity.");

            return Results.Json(
                new { status = "not_ready", service = "AgriSync", checks = new { userDb = "error", shramSafalDb = "error" } },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    })
    .WithName("GetBootstrapperReadiness")
    .WithTags("System")
    .AllowAnonymous();

    app.MapGet("/version", () => Results.Ok(new
    {
        service = "AgriSync",
        version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0",
        buildSha = Environment.GetEnvironmentVariable("BUILD_SHA") ?? "unknown",
        deployedAt = Environment.GetEnvironmentVariable("DEPLOYED_AT") ?? "unknown",
        environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "unknown"
    }))
    .WithName("GetVersion")
    .WithTags("System")
    .AllowAnonymous();

    app.MapUserApi();
    app.MapShramSafalApi();
    app.MapAccountsModuleEndpoints();
    app.MapFirstFarmBootstrapEndpoints();

    await InitializeApplicationDataAsync(app);

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "AgriSync.Bootstrapper failed to start.");
}
finally
{
    Log.CloseAndFlush();
}

static void ConfigureDevelopmentSwagger(WebApplication app)
{
    app.Use(async (context, next) =>
    {
        if (context.Request.Path.Equals("/swagger", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.Redirect("/swagger/index.html", permanent: false);
            return;
        }

        if (context.Request.Path.Equals("/swagger/index.html", StringComparison.OrdinalIgnoreCase)
            && (context.Request.Query.ContainsKey("url") || context.Request.Query.ContainsKey("configUrl")))
        {
            context.Response.Redirect("/swagger/index.html", permanent: false);
            return;
        }

        if (context.Request.Path.Equals("/swagger/swagger-config", StringComparison.OrdinalIgnoreCase))
        {
            context.Request.Path = "/swagger/v1/swagger.json";
        }

        if (context.Request.Path.StartsWithSegments("/swagger", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers.Expires = "0";
        }

        await next();
    });

    app.Use(async (ctx, next) =>
    {
        var path = ctx.Request.Path.Value;
        if (path is null || !path.EndsWith("swagger.json", StringComparison.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        var original = ctx.Response.Body;
        using var buffer = new MemoryStream();
        ctx.Response.Body = buffer;

        await next();

        buffer.Position = 0;
        var json = await new StreamReader(buffer).ReadToEndAsync();
        json = json.Replace("\"3.0.4\"", "\"3.0.3\"");

        ctx.Response.Body = original;
        ctx.Response.ContentLength = Encoding.UTF8.GetByteCount(json);
        await ctx.Response.WriteAsync(json);
    });

    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "AgriSync API v1");
    });
}

static void MapDevelopmentOnlyTestEndpoints(WebApplication app)
{
    app.MapGet("/test/db", async (UserDbContext db) =>
    {
        var result = new Dictionary<string, object>();
        try
        {
            var canConnect = await db.Database.CanConnectAsync();
            result["canConnect"] = canConnect;

            if (!canConnect)
            {
                result["status"] = "disconnected";
                return Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            var version = await db.Database.SqlQueryRaw<string>("SELECT version() AS \"Value\"").FirstOrDefaultAsync();
            result["postgresVersion"] = version ?? "unknown";
            var currentDatabase = await db.Database.SqlQueryRaw<string>("SELECT current_database() AS \"Value\"").FirstOrDefaultAsync();
            result["database"] = currentDatabase ?? "unknown";

            var userCount = await db.Users.CountAsync();
            result["userCount"] = userCount;

            var connString = db.Database.GetConnectionString()!;
            using var conn = new Npgsql.NpgsqlConnection(connString);
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;";
            var tables = new List<string>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    tables.Add(reader.GetString(0));
                }
            }

            result["tables"] = tables;

            var usrTables = new List<string>();
            await using (var usrCmd = conn.CreateCommand())
            {
                usrCmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'usr' ORDER BY table_name;";
                await using var usrReader = await usrCmd.ExecuteReaderAsync();
                while (await usrReader.ReadAsync())
                {
                    usrTables.Add(usrReader.GetString(0));
                }
            }

            result["usrTables"] = usrTables;
            result["schemaChecked"] = "public";
            result["status"] = "connected";
            return Results.Ok(result);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Development database connectivity test failed.");
            result["status"] = "error";
            result["message"] = "Database connectivity check failed";
            return Results.Json(result, statusCode: StatusCodes.Status500InternalServerError);
        }
    })
    .WithName("TestDatabaseConnectivity")
    .WithTags("System")
    .AllowAnonymous();

    app.MapPost("/test/db/init", async (User.Infrastructure.Persistence.UserDbContext userDb, ShramSafal.Infrastructure.Persistence.ShramSafalDbContext ssfDb, bool reset = false) =>
    {
        try
        {
            bool userDeleted = false;
            bool ssfDeleted = false;

            if (reset)
            {
                userDeleted = await userDb.Database.EnsureDeletedAsync();
                var sameConnection = string.Equals(
                    userDb.Database.GetConnectionString(),
                    ssfDb.Database.GetConnectionString(),
                    StringComparison.OrdinalIgnoreCase);

                if (!sameConnection)
                {
                    ssfDeleted = await ssfDb.Database.EnsureDeletedAsync();
                }
            }

            var userCreated = await EnsureContextTablesCreatedAsync(userDb, "public", "users");
            var ssfCreated = await EnsureContextTablesCreatedAsync(ssfDb, "ssf", "farms");
            return Results.Ok(new
            {
                status = "ok",
                resetPerformed = reset,
                userDatabaseDeleted = userDeleted,
                ssfDatabaseDeleted = ssfDeleted,
                userSchemaCreated = userCreated,
                ssfSchemaCreated = ssfCreated,
                message = "Database schemas initialized successfully"
            });
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Development database initialization endpoint failed.");
            return Results.Json(new
            {
                status = "error",
                message = "Database schema initialization failed"
            }, statusCode: StatusCodes.Status500InternalServerError);
        }
    })
    .WithName("InitDatabaseSchema")
    .WithTags("System")
    .AllowAnonymous();

    app.MapPost("/test/seed", async (AgriSync.Bootstrapper.Infrastructure.DatabaseSeeder seeder) =>
    {
        try
        {
            var result = await seeder.SeedDemoDataAsync();
            return Results.Ok(new { status = "ok", message = result });
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Development seed endpoint failed.");
            return Results.Json(new
            {
                status = "error",
                message = "Demo data seeding failed"
            }, statusCode: StatusCodes.Status500InternalServerError);
        }
    })
    .WithName("SeedDemoData")
    .WithTags("System")
    .AllowAnonymous();
}

static async Task InitializeApplicationDataAsync(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var services = scope.ServiceProvider;
    var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("AgriSync.Bootstrapper.Startup");
    try
    {
        var userContext = services.GetRequiredService<User.Infrastructure.Persistence.UserDbContext>();
        var ssfContext = services.GetRequiredService<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>();
        var analyticsContext = services.GetRequiredService<AnalyticsDbContext>();

        var userSchemaCreated = app.Environment.IsDevelopment()
            ? await EnsureContextTablesCreatedAsync(userContext, "public", "users")
            : await ApplyStartupMigrationsIfAllowedAsync(app, userContext, "UserDbContext");
        var ssfSchemaCreated = app.Environment.IsDevelopment()
            ? await EnsureContextTablesCreatedAsync(ssfContext, "ssf", "farms")
            : await ApplyStartupMigrationsIfAllowedAsync(app, ssfContext, "ShramSafalDbContext");
        // MIS rail — analytics events are append-only. Production deploys should replace
        // the EF-generated table with the partitioned schema from
        // _COFOUNDER/01_Operations/Plans/SHRAMSAFAL_MIS_INTEGRATION_PLAN_2026-04-18.md §4.2.
        var analyticsSchemaCreated = app.Environment.IsDevelopment()
            ? await EnsureContextTablesCreatedAsync(analyticsContext, "analytics", "events")
            : await ApplyStartupMigrationsIfAllowedAsync(app, analyticsContext, "AnalyticsDbContext");

        var seedBlankTestUser = app.Environment.IsDevelopment() || string.Equals(
            Environment.GetEnvironmentVariable("SEED_BLANK_TEST_USER"),
            "true",
            StringComparison.OrdinalIgnoreCase);
        if (seedBlankTestUser)
        {
            var blankSeeder = services.GetRequiredService<AgriSync.Bootstrapper.Infrastructure.BlankTestUserSeeder>();
            await blankSeeder.SeedAsync();
        }

        var seedRamuDemo = string.Equals(
            Environment.GetEnvironmentVariable("SEED_RAMU_DEMO"),
            "true",
            StringComparison.OrdinalIgnoreCase);
        if (seedRamuDemo)
        {
            var seeder = services.GetRequiredService<AgriSync.Bootstrapper.Infrastructure.DatabaseSeeder>();
            await seeder.SeedDemoDataAsync();
            Log.Information("Ramu demo seeding completed.");
        }

        var clearPurveshDemo = string.Equals(
            Environment.GetEnvironmentVariable("CLEAR_PURVESH_DEMO"),
            "true",
            StringComparison.OrdinalIgnoreCase);
        var seedPurveshDemo = string.Equals(
            Environment.GetEnvironmentVariable("SEED_PURVESH_DEMO"),
            "true",
            StringComparison.OrdinalIgnoreCase);

        if (clearPurveshDemo || seedPurveshDemo)
        {
            var purveshSeeder = services.GetRequiredService<AgriSync.Bootstrapper.Infrastructure.PurveshDemoSeeder>();

            if (clearPurveshDemo)
            {
                var clearResult = await purveshSeeder.ClearPurveshDemoAsync();
                Log.Information("Purvesh demo clear result: {Result}", clearResult);
            }

            if (seedPurveshDemo)
            {
                var seedResult = await purveshSeeder.SeedPurveshDemoAsync();
                Log.Information("Purvesh demo seed result: {Result}", seedResult);
            }
        }

        Log.Information(
            "Database initialization completed. Environment: {Environment}, UserSchemaChanged: {UserSchemaChanged}, SsfSchemaChanged: {SsfSchemaChanged}, AnalyticsSchemaChanged: {AnalyticsSchemaChanged}, seedRamu: {SeedRamuDemo}, clearPurvesh: {ClearPurveshDemo}, seedPurvesh: {SeedPurveshDemo}",
            app.Environment.EnvironmentName,
            userSchemaCreated,
            ssfSchemaCreated,
            analyticsSchemaCreated,
            seedRamuDemo,
            clearPurveshDemo,
            seedPurveshDemo);
    }
    catch (Exception ex)
    {
        logger.LogCritical(ex, "Application initialization failed. Shutting down.");
        if (!app.Environment.IsDevelopment())
        {
            throw;
        }

        logger.LogWarning("Continuing despite init failure because environment is Development.");
    }
}

static string ResolveRemoteIpRateLimitPartitionKey(HttpContext context)
{
    return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}

static string ResolveAiRateLimitPartitionKey(HttpContext context)
{
    var subject =
        context.User.FindFirst("sub")?.Value ??
        context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

    if (!string.IsNullOrWhiteSpace(subject))
    {
        return $"user:{subject}";
    }

    return $"ip:{ResolveRemoteIpRateLimitPartitionKey(context)}";
}

static async Task<bool> ApplyStartupMigrationsIfAllowedAsync(WebApplication app, DbContext context, string contextName)
{
    var pendingMigrations = (await context.Database.GetPendingMigrationsAsync()).ToArray();
    if (pendingMigrations.Length == 0)
    {
        Log.Information("No pending migrations for {ContextName}.", contextName);
        return false;
    }

    var allowProductionStartupMigrations =
        !app.Environment.IsProduction() ||
        string.Equals(
            Environment.GetEnvironmentVariable("ALLOW_PRODUCTION_STARTUP_MIGRATIONS"),
            "true",
            StringComparison.OrdinalIgnoreCase);

    if (!allowProductionStartupMigrations)
    {
        throw new InvalidOperationException(
            $"Pending migrations detected for {contextName}. Apply them in a deployment step before starting Production.");
    }

    Log.Information("Applying {MigrationCount} pending migrations for {ContextName}: {Migrations}", pendingMigrations.Length, contextName, pendingMigrations);
    await context.Database.MigrateAsync();
    return true;
}

static async Task<bool> EnsureContextTablesCreatedAsync(DbContext context, string schema, string tableName)
{
    var databaseCreator = context.GetService<IRelationalDatabaseCreator>();

    if (!await databaseCreator.ExistsAsync())
    {
        await databaseCreator.CreateAsync();
    }

    var tableExists = await context.Database
        .SqlQueryRaw<bool>(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = {0} AND table_name = {1}) AS \"Value\"",
            schema,
            tableName)
        .FirstAsync();

    if (tableExists)
    {
        return false;
    }

    await databaseCreator.CreateTablesAsync();
    return true;
}

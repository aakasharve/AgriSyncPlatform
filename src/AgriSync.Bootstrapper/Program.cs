using System.Text;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Serilog;
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

    builder.Host.UseSerilog((context, services, loggerConfiguration) =>
    {
        loggerConfiguration
            .ReadFrom.Configuration(context.Configuration)
            .ReadFrom.Services(services)
            .Enrich.FromLogContext()
            .WriteTo.Console();
    });

    builder.Services.AddBuildingBlocks();
    builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
    builder.Services.AddProblemDetails();
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();

    // CORS: allow the React frontend dev server to call API
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("AllowFrontendDev", policy =>
        {
            policy.WithOrigins(
                "http://localhost:3000", 
                "http://localhost:3001",
                "http://localhost:3002", 
                "http://localhost:5173",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://127.0.0.1:3002",
                "http://127.0.0.1:5173"
            )
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
        });
    });

    builder.Services.AddUserApi(builder.Configuration);
    builder.Services.AddShramSafalApi(builder.Configuration);
    builder.Services.AddTransient<AgriSync.Bootstrapper.Infrastructure.DatabaseSeeder>();
    builder.Services.AddTransient<AgriSync.Bootstrapper.Infrastructure.PurveshDemoSeeder>();

    QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

    var app = builder.Build();

    app.UseSerilogRequestLogging();
    app.UseExceptionHandler();
    app.UseCors("AllowFrontendDev");

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

        // Backward compatibility: some stale Swagger UI states request swagger-config as a spec URL.
        // Rewrite to the real OpenAPI document to avoid "Unable to render this definition" failures.
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

    // Swashbuckle 10.x emits OpenAPI 3.0.4 via Microsoft.OpenApi v2,
    // but the bundled Swagger UI does not recognise that patch version yet.
    // Downgrade the spec version string so the UI can render it.
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
        // Use an absolute route to avoid UI URL-resolution edge cases.
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "AgriSync API v1");
    });

    app.UseAuthentication();
    app.UseAuthorization();

    app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "AgriSync.Bootstrapper" }))
        .WithName("GetBootstrapperHealth")
        .WithTags("System");

    // ── Test Endpoint: PostgreSQL Connectivity ──────────────────────────
    app.MapGet("/test/db", async (UserDbContext db) =>
    {
        var result = new Dictionary<string, object>();
        try
        {
            // 1. Test connectivity via EF
            var canConnect = await db.Database.CanConnectAsync();
            result["canConnect"] = canConnect;

            if (!canConnect)
            {
                result["status"] = "disconnected";
                return Results.Json(result, statusCode: 503);
            }

            // 2. Get PostgreSQL version via EF raw SQL
            var version = await db.Database.SqlQueryRaw<string>("SELECT version() AS \"Value\"").FirstOrDefaultAsync();
            result["postgresVersion"] = version ?? "unknown";
            var currentDatabase = await db.Database.SqlQueryRaw<string>("SELECT current_database() AS \"Value\"").FirstOrDefaultAsync();
            result["database"] = currentDatabase ?? "unknown";

            // 3. User count
            var userCount = await db.Users.CountAsync();
            result["userCount"] = userCount;

            // 4. List tables via separate connection
            var connString = db.Database.GetConnectionString()!;
            using var conn = new Npgsql.NpgsqlConnection(connString);
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;";
            var tables = new List<string>();
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    tables.Add(reader.GetString(0));
            }
            result["tables"] = tables;

            // 5. Diagnostic: check any legacy tables under usr schema
            var usrTables = new List<string>();
            await using (var usrCmd = conn.CreateCommand())
            {
                usrCmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'usr' ORDER BY table_name;";
                await using var usrReader = await usrCmd.ExecuteReaderAsync();
                while (await usrReader.ReadAsync())
                    usrTables.Add(usrReader.GetString(0));
            }
            result["usrTables"] = usrTables;
            result["schemaChecked"] = "public";

            result["status"] = "connected";
            return Results.Ok(result);
        }
        catch (Exception ex)
        {
            result["status"] = "error";
            result["error"] = ex.Message;
            result["innerError"] = ex.InnerException?.Message ?? "";
            return Results.Json(result, statusCode: 500);
        }
    })
    .WithName("TestDatabaseConnectivity")
    .WithTags("System")
    .AllowAnonymous();

    // ── Test Endpoint: Bootstrap Database Schema ────────────────────────
    // ── Test Endpoint: Bootstrap Database Schema ────────────────────────
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
            return Results.Json(new
            {
                status = "error",
                error = ex.Message,
                innerError = ex.InnerException?.Message ?? ""
            }, statusCode: 500);
        }
    })
    .WithName("InitDatabaseSchema")
    .WithTags("System")
    .AllowAnonymous();

    // ── Test Endpoint: Seed Demo Data ──────────────────────────────────
    app.MapPost("/test/seed", async (AgriSync.Bootstrapper.Infrastructure.DatabaseSeeder seeder) =>
    {
        try
        {
            var result = await seeder.SeedDemoDataAsync();
            return Results.Ok(new { status = "ok", message = result });
        }
        catch (Exception ex)
        {
             return Results.Json(new
            {
                status = "error",
                error = ex.Message,
                innerError = ex.InnerException?.Message ?? ""
            }, statusCode: 500);
        }
    })
    .WithName("SeedDemoData")
    .WithTags("System")
    .AllowAnonymous();

    app.MapUserApi();
    app.MapShramSafalApi();

    // Auto-seed demo data on startup
    using (var scope = app.Services.CreateScope())
    {
        var services = scope.ServiceProvider;
        try 
        {
            // Ensure Database Created
            var userContext = services.GetRequiredService<User.Infrastructure.Persistence.UserDbContext>();
            var ssfContext = services.GetRequiredService<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>();

            var userSchemaCreated = await EnsureContextTablesCreatedAsync(userContext, "public", "users");
            var ssfSchemaCreated = await EnsureContextTablesCreatedAsync(ssfContext, "ssf", "farms");

            // Seed Data — each seeder is gated behind an env var so no demo data
            // runs automatically on a fresh deployment.
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
                "Database initialization completed. UserSchema: {UserSchemaCreated}, SsfSchema: {SsfSchemaCreated}, seedRamu: {SeedRamuDemo}, clearPurvesh: {ClearPurveshDemo}, seedPurvesh: {SeedPurveshDemo}",
                userSchemaCreated,
                ssfSchemaCreated,
                seedRamuDemo,
                clearPurveshDemo,
                seedPurveshDemo);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "An error occurred while initializing or seeding the database.");
        }
    }

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

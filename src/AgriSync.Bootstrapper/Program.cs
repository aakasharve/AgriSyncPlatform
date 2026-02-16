using System.Text;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks;
using Microsoft.EntityFrameworkCore;
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
            policy.WithOrigins("http://localhost:3000", "http://localhost:5173")
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        });
    });

    builder.Services.AddUserApi(builder.Configuration);
    builder.Services.AddShramSafalApi(builder.Configuration);

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
            // 1. Test raw connection
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync();
            result["connectionState"] = conn.State.ToString();

            // 2. DB version
            using var versionCmd = conn.CreateCommand();
            versionCmd.CommandText = "SELECT version();";
            var version = await versionCmd.ExecuteScalarAsync();
            result["postgresVersion"] = version?.ToString() ?? "unknown";

            // 3. List tables in usr schema
            using var tablesCmd = conn.CreateCommand();
            tablesCmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'usr' ORDER BY table_name;";
            var tables = new List<string>();
            using var reader = await tablesCmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                tables.Add(reader.GetString(0));
            result["tables"] = tables;

            // 4. User count
            var userCount = await db.Users.CountAsync();
            result["userCount"] = userCount;

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

    app.MapUserApi();
    app.MapShramSafalApi();

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

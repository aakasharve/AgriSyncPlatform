using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks;
using Serilog;
using ShramSafal.Api;
using User.Api;

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
    builder.Services.AddUserApi(builder.Configuration);
    builder.Services.AddShramSafalApi(builder.Configuration);

    var app = builder.Build();

    app.UseSerilogRequestLogging();
    app.UseExceptionHandler();

    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "AgriSync API v1");
    });

    app.UseAuthentication();
    app.UseAuthorization();

    app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "AgriSync.Bootstrapper" }))
        .WithName("GetBootstrapperHealth")
        .WithTags("System");

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

using User.Api.Endpoints;

namespace User.Api;

public static class ModuleEndpoints
{
    public static IEndpointRouteBuilder MapUserApi(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/user").WithTags("User");

        group.MapGet("/health", () => Results.Ok(new
        {
            module = "User",
            status = "ok"
        }))
        .WithName("GetUserModuleHealth");

        endpoints.MapAuthEndpoints();

        return endpoints;
    }
}

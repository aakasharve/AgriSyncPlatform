using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Errors;

public class AppException : Exception
{
    public AppException(string code, string message, int statusCode = StatusCodes.Status400BadRequest, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        StatusCode = statusCode;
    }

    public string Code { get; }

    public int StatusCode { get; }
}

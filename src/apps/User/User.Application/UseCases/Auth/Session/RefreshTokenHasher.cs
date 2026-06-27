using System.Security.Cryptography;
using System.Text;

namespace User.Application.UseCases.Auth.Session;

public static class RefreshTokenHasher
{
    public static string Hash(string refreshToken)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken)));
    }
}

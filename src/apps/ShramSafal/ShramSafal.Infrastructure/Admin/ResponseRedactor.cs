using System.Collections.Concurrent;
using System.Reflection;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Infrastructure.Admin;

/// <summary>
/// Applies RedactionMatrix field-level policies to outbound DTOs just before
/// serialisation. Uses reflection against the DTO's primary constructor
/// (records) or positional ctor (sealed classes) and returns a new instance
/// — the input DTO is never mutated in place.
///
/// Per-type reflection is cached (PropCache) so the hot path is a ConcurrentDictionary lookup
/// plus a single ctor.Invoke. No JsonConverter — the matrix lookup needs
/// orgType+orgRole+moduleKey, which a converter cannot safely thread through
/// async boundaries without context leaks.
/// </summary>
public sealed class ResponseRedactor : IResponseRedactor
{
    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> PropCache = new();

    public T Redact<T>(T dto, AdminScope scope, string moduleKey) where T : class
    {
        var policy = RedactionMatrix.For(scope.OrganizationType, scope.OrganizationRole, moduleKey);
        return ApplyPolicy(dto, policy);
    }

    public IReadOnlyList<T> RedactMany<T>(IEnumerable<T> dtos, AdminScope scope, string moduleKey)
        where T : class
    {
        var policy = RedactionMatrix.For(scope.OrganizationType, scope.OrganizationRole, moduleKey);
        return dtos.Select(d => ApplyPolicy(d, policy)).ToList();
    }

    private static T ApplyPolicy<T>(T dto, FieldRedactionPolicy policy) where T : class
    {
        var type = typeof(T);
        var props = PropCache.GetOrAdd(type, t =>
            t.GetProperties(BindingFlags.Public | BindingFlags.Instance));

        // Use the longest-arity public constructor — this matches records'
        // positional primary constructors and classes with a parameterised ctor.
        var ctor = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
            .OrderByDescending(c => c.GetParameters().Length)
            .FirstOrDefault();
        if (ctor is null) return dto;

        var parameters = ctor.GetParameters();
        if (parameters.Length == 0) return dto;

        var args = new object?[parameters.Length];
        for (int i = 0; i < parameters.Length; i++)
        {
            var paramName = parameters[i].Name ?? string.Empty;

            // Policy lookup is camelCase-first (mirrors JSON field naming);
            // fall back to the raw parameter name for PascalCase policies.
            var camel = paramName.Length > 0
                ? char.ToLowerInvariant(paramName[0]) + paramName[1..]
                : paramName;
            var access = policy.For(camel);
            if (access == FieldAccess.Full)
                access = policy.For(paramName);

            var matching = props.FirstOrDefault(
                p => string.Equals(p.Name, paramName, StringComparison.OrdinalIgnoreCase));
            var currentValue = matching?.GetValue(dto);

            args[i] = access switch
            {
                FieldAccess.Full => currentValue,
                FieldAccess.Masked => Mask(currentValue, parameters[i].ParameterType),
                FieldAccess.Aggregated => DefaultOf(parameters[i].ParameterType),
                FieldAccess.Hidden => DefaultOf(parameters[i].ParameterType),
                _ => currentValue
            };
        }
        return (T)ctor.Invoke(args);
    }

    private static object? Mask(object? value, Type type)
    {
        if (value is null) return null;
        if (type == typeof(string))
        {
            var s = (string)value;
            if (s.Length <= 2) return "**";
            if (s.Length <= 4) return s[..1] + new string('*', s.Length - 2) + s[^1..];
            return s[..2] + new string('*', s.Length - 4) + s[^2..];
        }
        // For non-string types (numbers, dates, guids) masking is equivalent to hiding.
        return DefaultOf(type);
    }

    private static object? DefaultOf(Type t) => t.IsValueType ? Activator.CreateInstance(t) : null;
}

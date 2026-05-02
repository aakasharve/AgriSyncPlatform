using System.Diagnostics.CodeAnalysis;

namespace AgriSync.BuildingBlocks.Results;

public class Result
{
    protected Result(bool isSuccess, Error error)
    {
        if (isSuccess && error != Error.None)
        {
            throw new ArgumentException("Successful result cannot contain an error.", nameof(error));
        }

        if (!isSuccess && error == Error.None)
        {
            throw new ArgumentException("Failure result must contain an error.", nameof(error));
        }

        IsSuccess = isSuccess;
        Error = error;
    }

    public bool IsSuccess { get; }

    public bool IsFailure => !IsSuccess;

    public Error Error { get; }

    public static Result Success() => new(true, Error.None);

    public static Result Failure(Error error) => new(false, error);

    public static Result<TValue> Success<TValue>(TValue value) => new(value, true, Error.None);

    public static Result<TValue> Failure<TValue>(Error error) => new(default, false, error);
}

public sealed class Result<TValue> : Result
{
    internal Result(TValue? value, bool isSuccess, Error error)
        : base(isSuccess, error)
    {
        Value = value;
    }

    public TValue? Value { get; }

    /// <summary>
    /// Shadows <see cref="Result.IsSuccess"/> to add a flow-analysis hint for
    /// the C# nullable analyzer: when this returns <see langword="true"/>,
    /// <see cref="Value"/> is non-null. Callers with the static type
    /// <c>Result&lt;T&gt;</c> can therefore dereference <see cref="Value"/>
    /// after a guard like <c>Assert.True(result.IsSuccess)</c> or a
    /// <c>result.IsSuccess ? … : …</c> ternary without triggering CS8602.
    /// Production-shape: identical behaviour to <see cref="Result.IsSuccess"/>.
    /// </summary>
    [MemberNotNullWhen(returnValue: true, nameof(Value))]
    public new bool IsSuccess => base.IsSuccess;
}

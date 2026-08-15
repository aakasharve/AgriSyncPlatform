namespace ShramSafal.Domain.Finance;

/// <summary>
/// Which way the money moved, as the farmer stated it.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately has NO <c>Unknown</c> member. "Unknown" is the absence of a
/// statement, and the type system already has a word for absence:
/// <see cref="Nullable{T}"/>. A <c>MoneyDirection?</c> that is <c>null</c> is a
/// row nobody ever told us about; a sentinel member would let that silence be
/// stored, compared and displayed as if it were an answer.
/// </para>
/// <para>
/// This is a STATED field (`P1`). It must never be derived from the sign of an
/// amount — a negative number is not a direction — nor from the category — a
/// category is not a direction. Every <c>CostEntry</c> written before this type
/// existed carries <c>null</c>, and every read of those rows must keep saying
/// so rather than picking the likelier side (`P4`).
/// </para>
/// </remarks>
public enum MoneyDirection
{
    /// <summary>Money left the farm.</summary>
    Expense = 1,

    /// <summary>Money came in — a sale, a subsidy, a repayment.</summary>
    Income = 2,
}

using System.Data.Common;
using AgriSync.BuildingBlocks.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING: pairs with
/// <see cref="DomainEventToOutboxInterceptor"/> to close the
/// explicit-transaction rollback hole that the SaveChanges-only
/// interceptor cannot cover by itself.
///
/// <para>
/// <b>The hole.</b> The save-side interceptor clears in-memory
/// <see cref="Entity{TId}.DomainEvents"/> in
/// <c>SavedChanges(Async)</c>. That fires AFTER <c>SaveChangesAsync</c>
/// returns successfully but BEFORE an explicit
/// <c>Transaction.CommitAsync</c>. If the caller then rolls the
/// transaction back, the OutboxMessage rows are gone (with the
/// transaction) but the in-memory events were already cleared — so a
/// retry would not re-emit them.
/// </para>
///
/// <para>
/// <b>The fix.</b> Snapshots are accumulated by the save-side
/// interceptor on a per-(DbContext, TransactionId) bucket whenever a
/// <c>SaveChanges</c> runs inside an explicit transaction. This
/// transaction interceptor keys discard / restore by the
/// <see cref="TransactionEventData.TransactionId"/> EF Core hands us
/// on the end / error callbacks:
/// <list type="bullet">
/// <item><see cref="TransactionCommitted"/> /
/// <see cref="TransactionCommittedAsync"/>: drop that transaction's
/// bucket — the events are durably published.</item>
/// <item><see cref="TransactionRolledBack"/> /
/// <see cref="TransactionRolledBackAsync"/>: restore every accumulated
/// batch in that bucket onto its aggregate so a retry resends the
/// events. Earlier batches are restored last so the queue ends up in
/// original temporal order.</item>
/// <item><see cref="TransactionFailed"/> /
/// <see cref="TransactionFailedAsync"/>: a driver-level abort is
/// treated identically to an explicit rollback.</item>
/// </list>
/// </para>
///
/// <para>
/// Per-transaction keying matters for two reasons:
/// <list type="number">
/// <item>An execution-strategy retry (<c>EnableRetryOnFailure</c>)
/// re-runs the user's lambda, which opens a NEW transaction with a new
/// <c>TransactionId</c>. The first attempt's stale bucket cannot leak
/// into the second attempt.</item>
/// <item>An implicit save followed by an unrelated explicit rollback
/// on the same context cannot resurrect events: the implicit save
/// never created a bucket (no transaction was active at
/// <c>SavedChanges</c> time), so there is nothing for the unrelated
/// rollback to find.</item>
/// </list>
/// </para>
/// </summary>
public sealed class OutboxTransactionInterceptor : DbTransactionInterceptor
{
    private readonly DomainEventToOutboxInterceptor _saveSide;

    public OutboxTransactionInterceptor(DomainEventToOutboxInterceptor saveSide)
    {
        _saveSide = saveSide;
    }

    public override void TransactionCommitted(
        DbTransaction transaction,
        TransactionEndEventData eventData)
    {
        Discard(eventData);
        base.TransactionCommitted(transaction, eventData);
    }

    public override Task TransactionCommittedAsync(
        DbTransaction transaction,
        TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Discard(eventData);
        return base.TransactionCommittedAsync(transaction, eventData, cancellationToken);
    }

    public override void TransactionRolledBack(
        DbTransaction transaction,
        TransactionEndEventData eventData)
    {
        Restore(eventData);
        base.TransactionRolledBack(transaction, eventData);
    }

    public override Task TransactionRolledBackAsync(
        DbTransaction transaction,
        TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Restore(eventData);
        return base.TransactionRolledBackAsync(transaction, eventData, cancellationToken);
    }

    public override void TransactionFailed(
        DbTransaction transaction,
        TransactionErrorEventData eventData)
    {
        // Driver-level abort: treat as rollback so the caller's retry
        // resends the events.
        Restore(eventData);
        base.TransactionFailed(transaction, eventData);
    }

    public override Task TransactionFailedAsync(
        DbTransaction transaction,
        TransactionErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Restore(eventData);
        return base.TransactionFailedAsync(transaction, eventData, cancellationToken);
    }

    private void Restore(TransactionEventData eventData)
    {
        if (eventData.Context is { } ctx)
        {
            _saveSide.RestoreTxSnapshot(ctx, eventData.TransactionId);
        }
    }

    private void Discard(TransactionEventData eventData)
    {
        if (eventData.Context is { } ctx)
        {
            _saveSide.DiscardTxSnapshot(ctx, eventData.TransactionId);
        }
    }
}

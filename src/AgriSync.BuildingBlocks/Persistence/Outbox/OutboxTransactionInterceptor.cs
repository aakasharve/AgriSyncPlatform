using System.Data.Common;
using System.Runtime.CompilerServices;
using AgriSync.BuildingBlocks.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;

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
/// <b>The fix.</b> When an explicit transaction is started on a
/// DbContext that uses the outbox interceptors, this interceptor
/// hooks in and:
/// <list type="number">
/// <item>On <see cref="TransactionCommitting"/> /
/// <see cref="TransactionCommitted"/>: confirms the in-memory clear
/// that the save-side interceptor staged. Nothing additional is
/// strictly needed here because the save-side interceptor already
/// cleared on success — but we record the commit so a parallel
/// <see cref="TransactionRolledBack"/> for the same transaction
/// becomes a no-op.</item>
/// <item>On <see cref="TransactionRolledBack"/> /
/// <see cref="TransactionFailed"/>: walks the change tracker for any
/// <see cref="Entity{TId}"/> whose <c>DomainEvents</c> queue is
/// empty AND whose row was just rolled back, and "re-arms" the
/// in-memory queue from a snapshot the save-side interceptor stored
/// on this context for exactly this purpose.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Snapshot lifetime.</b> The save-side interceptor stashes a
/// per-context "events I just cleared" list on a side-table
/// (<see cref="DomainEventToOutboxInterceptor.RegisterCommitSnapshot"/>)
/// keyed by <see cref="DbContext"/>. The transaction interceptor reads
/// that on rollback to restore. After commit (or after a non-rollback
/// dispose) the snapshot is discarded.
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
        DiscardCommitSnapshot(eventData.Context);
        base.TransactionCommitted(transaction, eventData);
    }

    public override Task TransactionCommittedAsync(
        DbTransaction transaction,
        TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        DiscardCommitSnapshot(eventData.Context);
        return base.TransactionCommittedAsync(transaction, eventData, cancellationToken);
    }

    public override void TransactionRolledBack(
        DbTransaction transaction,
        TransactionEndEventData eventData)
    {
        RestoreFromCommitSnapshot(eventData.Context);
        base.TransactionRolledBack(transaction, eventData);
    }

    public override Task TransactionRolledBackAsync(
        DbTransaction transaction,
        TransactionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        RestoreFromCommitSnapshot(eventData.Context);
        return base.TransactionRolledBackAsync(transaction, eventData, cancellationToken);
    }

    public override void TransactionFailed(
        DbTransaction transaction,
        TransactionErrorEventData eventData)
    {
        // A failed transaction (driver-level abort) is treated the
        // same as an explicit rollback: re-arm the events so the
        // caller's retry resends them.
        RestoreFromCommitSnapshot(eventData.Context);
        base.TransactionFailed(transaction, eventData);
    }

    public override Task TransactionFailedAsync(
        DbTransaction transaction,
        TransactionErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        RestoreFromCommitSnapshot(eventData.Context);
        return base.TransactionFailedAsync(transaction, eventData, cancellationToken);
    }

    private void RestoreFromCommitSnapshot(DbContext? context)
    {
        if (context is null)
        {
            return;
        }
        _saveSide.RestoreCommitSnapshot(context);
    }

    private void DiscardCommitSnapshot(DbContext? context)
    {
        if (context is null)
        {
            return;
        }
        _saveSide.DiscardCommitSnapshot(context);
    }
}

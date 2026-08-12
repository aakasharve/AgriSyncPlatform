using System.Text.Json.Serialization;

namespace ShramSafal.Domain.Logs;

/// <summary>
/// What the farmer actually asserted about WHERE a <see cref="DailyLog"/> happened.
/// Founder decision O-1 (2026-08-12): "Entire Farm" is an intentional domain
/// assertion — never an arbitrary plot, fake cycle, sentinel, "first available
/// plot", or a NULL whose meaning has to be guessed later.
/// </summary>
/// <remarks>
/// Persisted as the literal member name in <c>ssf.daily_logs.scope varchar(10)</c>
/// (<c>HasConversion&lt;string&gt;()</c>, the same shape
/// <c>disturbance_events.scope</c> already uses). The names below are load-bearing:
/// the <c>ck_daily_logs_scope</c> CHECK constraint compares against these exact
/// strings, so renaming a member is a schema change, not a refactor.
///
/// <para>
/// <b>Why the explicit converter.</b> The names are load-bearing in a SECOND
/// durable place, and it is not the one above. <c>DailyLogCreatedEvent</c> is
/// serialized into <c>outbox_messages.payload</c> by
/// <c>DomainEventToOutboxInterceptor</c> using
/// <c>new JsonSerializerOptions(JsonSerializerDefaults.Web)</c>, which carries
/// NO string-enum converter — so without this attribute this enum lands in the
/// payload as its ORDINAL (<c>"scope":0</c>) and is read back POSITIONALLY.
/// Two durable records of one fact would then disagree the day a member is
/// inserted between two existing ones: every historical payload carrying
/// <c>1</c> silently becomes the new member, while <c>ssf.daily_logs.scope</c>
/// for the same log still reads <c>MultiPlot</c> — and nothing errors. Renaming
/// a member is already a schema change; this makes REORDERING one merely a
/// rename-shaped mistake instead of a silent, undetectable divergence.
/// </para>
/// <para>
/// The converter is applied to THIS TYPE, not to the shared serializer options
/// — the same type-scoped pattern the SharedKernel id types already use
/// (<c>UserId</c>, <c>FarmId</c>, …). A global option change would alter the
/// on-the-wire shape of every other event payload in the system at once.
/// Reading is unaffected for existing rows: <c>JsonStringEnumConverter</c>
/// defaults to <c>allowIntegerValues: true</c>, so a legacy <c>"scope":0</c>
/// payload still deserializes to <see cref="Plot"/>.
/// </para>
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter<DailyLogScope>))]
public enum DailyLogScope
{
    /// <summary>
    /// One named plot AND its crop cycle. The Labour V1 shape.
    /// <c>crop_cycle_id</c> is required for this scope — column-level
    /// <c>NOT NULL</c> since the table was created, and restated in
    /// <c>ck_daily_logs_scope</c> so dropping that <c>NOT NULL</c> for the
    /// farm-wide case did not quietly retire it for this one.
    /// </summary>
    Plot,

    /// <summary>
    /// Two or more named plots sharing ONE engagement (founder decision O-2).
    /// Carries no single <c>plot_id</c> and no <c>crop_cycle_id</c> — cross-cycle
    /// attribution is explicitly deferred rather than guessed.
    /// </summary>
    MultiPlot,

    /// <summary>संपूर्ण शेत — the whole farm, with no plot named at all.</summary>
    Farm,
}

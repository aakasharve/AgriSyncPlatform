# Error Capture Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every recorded API failure carry the name of the error, what it means in plain words, which app build the farmer was on, and whether the farmer's work survived — so nobody has to reverse-engineer a `500`.

**Architecture:** The named-error catalogue (`ShramSafalErrors` + `UserErrors`, 58 errors) and the observability middleware both already exist and are correct. Two things break the chain between them:

1. **Nothing carries the error's identity from the endpoint to the middleware.** The middleware sees only `HttpContext`; the `Error` object dies inside the endpoint. `ErrorHttpExtensions.ToHttpResult()` — the shared mapper that *would* have been the seam — has **exactly one production caller** in the whole repo (`SubscriptionWebhookEndpoints.cs:122`). Every farmer-facing failure instead goes through one of **27 duplicated private `ToErrorResult(Error)` helpers** in `ShramSafal.Api/Endpoints/`, none of which touch `ProblemDetailsMapper` and none of which see `HttpContext`. Unhandled exceptions produce **no row at all** (see Task 5).
2. **`EventVocabulary` permits only `endpoint`, `status`, `farmId` on an `api.error`**, so even if the identity arrived, the contract would discard it.

This plan closes both: it stamps the identity on `HttpContext.Items` from inside an `IResult` wrapper (behaviour-preserving by construction), applies that wrapper to all 27 mappers plus the shared one, adds an architecture test that makes a 28th unstamped mapper a build failure, catches the unhandled-exception path in the middleware, and widens the vocabulary, the middleware payload and the admin DTO to carry it.

**Tech Stack:** .NET 10, ASP.NET Core minimal APIs, `Result<T>`/`Error` from `AgriSync.BuildingBlocks`, xUnit. **FluentAssertions is NOT uniform** — `Analytics.UnitTests`, `ShramSafal.Domain.Tests`, `ShramSafal.Admin.IntegrationTests` and `AgriSync.ArchitectureTests` carry `FluentAssertions 8.9.0`; `AgriSync.BuildingBlocks.Tests` deliberately does **not** (documented project convention: `ConsentEnforcerTests.cs:5-6`, "xUnit Assert directly — no FluentAssertions dep in BuildingBlocks tests"). Every test in this plan is written in the style of the project it lands in. Do not "tidy" them into one style.

**Spec:** `_COFOUNDER/specs/_active/2026-08-30-error-capture-engine.md` — **does not exist yet; Task 0 creates it.** No task after Task 0 may run until it is committed (Oath 1: no spec, no PR).

## Global Constraints

> **Commit subject — max 72 characters.** `.husky/commit-msg:26` rejects anything longer. Four of
> this plan's own verbatim subjects were 73–77 and were refused in execution. Check the length
> before committing, not after.

> **Commit trailer — verified against the hook, 2026-08-30.** Every commit touching `src/**` must
> carry a lowercase `spec: error-capture-engine` line in the body. `.husky/commit-msg:45` greps
> `(spec:\s*[a-z0-9-]+|\[hotfix\])` **case-sensitively** — a capital `Spec:` is rejected, and the
> value must be the spec ID, not a filename. An earlier draft of this plan carried `Spec:` with a
> filename in all eight commit blocks; every one would have been refused.

> **The spec lives at** `_COFOUNDER/specs/_active/2026-08-30-error-capture-engine.md`, per the root
> `CLAUDE.md` rule that a PR references a spec ID from `_COFOUNDER/specs/_active/`. An earlier draft
> pointed at `docs/superpowers/specs/`, which does not contain it.


- **`errorCode` and `workKept` are REQUIRED on every `api.error`.** Founder decision, 2026-08-30. An error that cannot name itself is a build failure.
  - *Honest scope of that word:* `RequiredProps` is enforced by `IngestEventsValidator.cs:79-96`, which only sees events arriving at `POST /analytics/events`. The middleware writes through `IAnalyticsWriter` and never passes that validator. So "required" is held on the middleware path by **Task 7's parity test**, and coverage of the *codes themselves* is held by **Task 2's reflection gate**. Both are named because neither alone is sufficient.
- **`workKept` is three-state: `kept` / `lost` / `unknown`.** Required means it must be *stated*, never that it must be *known*. Fabricating an outcome violates doctrine `P4`. **`lost` is only ever recorded when refused work was actually observed** (`rejectedWorkItems > 0`). A 4xx or 5xx on a write is `unknown`, not `lost` — `ShramSafal.DuplicateLogRequest` (409), `ShramSafal.ScheduleAlreadyAdopted` (409), `ShramSafal.AttachmentAlreadyFinalized` (409) and `ShramSafal.LabourAssignment.Conflict` (409) all fire *because the work was already stored*. Calling those `lost` would be a fabricated fact read as evidence a farmer lost a day.
- **Never farmer content in analytics props.** The rule is stated at `RequestObservabilityMiddleware.cs:106` — "Codes and counts only — never farmer content." `analytics.events` is append-only (`analytics_events_no_update` / `analytics_events_no_delete` `DO INSTEAD NOTHING` rules), so anything written there can never be scrubbed. Consequently this plan **does not record `Error.Description`**, because descriptions are not uniformly static — `Msg91SmsSender.cs:74` builds one with string interpolation (`$"MSG91 returned HTTP {(int)response.StatusCode}."`) and `AiEndpoints` has several more. The recorded `message` is instead the **authored** `ErrorExplanations` meaning, which cannot contain anything but text we wrote for this purpose. Exception **messages** are never recorded either — only `ex.GetType().Name`, which is a code.
- **No behaviour may change to gain error-code capture.** Founder decision, 2026-08-30. *Restated against the measured repo:* the original wording said "no call site may change… dozens of `.ToHttpResult()` callers exist." That premise was false — there is one caller. The intent behind it (an incomplete edit re-opens the gap silently) is honoured a different way: the 27 mappers each gain a two-line **wrapper that delegates to their existing body verbatim**, so no status code and no response body changes anywhere, and `ErrorCaptureCoverageTests` (Task 2) turns an incomplete or future-regressed application into a **red build**, not a silent gap. **Zero of the ~161 `ToErrorResult(...)` call sites change.**
- **The response wire shape is frozen.** The 27 mappers return `{ "error": <code>, "message": <description> }` (or a bare string, or `Results.Forbid()` with no body) — **not** RFC 7807. APK v1.0.9 / versionCode 17 is in the field and bundles its assets at build time, so it cannot be updated in step with the server (`P11`). **Do not collapse the 27 mappers onto `ToHttpResult`** — that would change both the body shape and several status codes (e.g. `ShramSafal.CropCycleOverlap` is `400` today under `LogsEndpoints`' suffix heuristic and would become `409`).
- **Existing consumers of `analytics.events` must not break.** New props are additive and **`statusCode` keeps its name**. Three live SQL readers depend on it: `AdminOpsRepository.cs:99`, `AdminOpsRepository.cs:226`, `AdminFarmerHealthRepository.cs:367`. `mis.alert_r9_api_error_spike` counts `api.error` rows and reads no props. `AdminOpsPage.tsx:69-72` renders the status badge from `statusCode`.
- **`api.slow` and `sync.mutation_rejected` keep exactly their current props shape.** The middleware serializes one bag for three event types; only `api.error` gains the new keys. `AnalyticsEventType.cs:58-71` records at length why `sync.mutation_rejected` was deliberately separated from `api.error` — do not blur them at the props layer after separating them at the type layer. Neither is in the frozen 13-name registry, so nothing documents their shape; that pre-existing gap is **out of scope** and stated, not fixed.
- Conventional Commits. No `--no-verify`. Architecture tests must pass: `dotnet test src/tests/AgriSync.ArchitectureTests/`.

---

## Change Surface

**DB** — **No schema changes.** `analytics.events.props` is a `jsonb` column with a `'{}'` default, no CHECK constraint, no key-level constraint and no expression index on props keys (`AnalyticsInitial.cs`). New keys need no migration, no index, no RLS change, no seed change, no backfill. Historical rows simply lack the new keys and read back as SQL `NULL`.

**Backend** —
- `AgriSync.BuildingBlocks`
  - Modify `Analytics/RequestObservabilityKeys.cs` — 2 new keys (`ErrorCode`, `UnhandledExceptionType`).
  - **New** `Results/ErrorCapture.cs` — `ErrorCapture.Stamp(Error, IResult)` + the public `CapturedErrorResult` wrapper.
  - Modify `Results/ErrorHttpExtensions.cs` — routes its existing result through `ErrorCapture.Stamp`.
  - **New** `Results/ErrorExplanations.cs` — the `ErrorExplanation` record + the 58 plain-language explanations. Placed here, not in `ShramSafal.Domain`, because it must cover **both** `ShramSafalErrors` (52) and `UserErrors` (6), and `DependencyRuleTests.ShramSafal_Domain_Does_Not_Depend_On_User_Domain` forbids the cross-context reach. Both Domain projects already reference BuildingBlocks; so does `ShramSafal.Infrastructure`.
  - **New** `Analytics/RequestObservabilityProps.cs` — the whole props bag, testable without a middleware.
- `ShramSafal.Api` — **27 endpoint files**, each gaining a two-line stamping wrapper around its existing, unmodified mapper body. Exhaustive list in Task 2. **No status code and no response body changes.**
- `Analytics.Domain` — `Vocabulary/EventVocabulary.cs:72-76` (the `api.error` definition widened).
- `AgriSync.Bootstrapper` — `Middleware/RequestObservabilityMiddleware.cs`: `InvokeAsync` gains try/catch/finally so the emit runs on the unhandled-exception path (it does not today), and the anonymous props object at lines 97-111 is replaced by a call to `RequestObservabilityProps.Build`.
- `ShramSafal.Application` — `Contracts/Dtos/AdminOpsHealthDto.cs` (`OpsErrorEventDto` widened). `Ports/IAdminOpsRepository.cs` is **unchanged** — no signature moves.
- `ShramSafal.Infrastructure` — `Persistence/Repositories/AdminOpsRepository.cs`: **two** projections and **two** positional `new OpsErrorEventDto(...)` constructions — `GetRecentErrorsAsync` (lines 85-123, backs `/admin/ops/health`) and `GetErrorsPagedAsync` (lines 196-255, backs `/admin/ops/errors`). Both are named because widening a positional record breaks both.
- No config changes, no new env vars, **no new NuGet packages** — every test lands in a project that already has what it uses.

**Tests** —
- **New** `src/tests/AgriSync.ArchitectureTests/ErrorCaptureCoverageTests.cs`
- **New** `src/tests/AgriSync.ArchitectureTests/ErrorExplanationCoverageTests.cs`
- **New** `src/tests/AgriSync.ArchitectureTests/RequestObservabilityMiddlewareTests.cs`
- **New** `src/tests/AgriSync.ArchitectureTests/ApiErrorContractParityTests.cs`
- **New** `src/tests/AgriSync.BuildingBlocks.Tests/Analytics/RequestObservabilityPropsTests.cs`
- **New** `src/tests/ShramSafal.Admin.IntegrationTests/AdminOpsErrorProjectionTests.cs` — **the first test coverage `AdminOpsRepository` has ever had.** A search for `GetErrorsPagedAsync` or `AdminOpsRepository` under `src/tests/` returns zero files today. It is new, not an extension.
- Modify `src/tests/AgriSync.BuildingBlocks.Tests/Results/ErrorHttpExtensionsTests.cs` — its two tests assert the **exact** returned type (`Assert.IsType<ProblemHttpResult>`), which is not assignable-to. Task 1 changes them. 7 cases.
- Modify `src/tests/Analytics.UnitTests/EventVocabularyTests.cs` — `Validator_Accepts_ApiError_With_Empty_Props_Bag` asserts the exact opposite of Task 6 and is deliberately replaced.
- `src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj` — **NO CHANGE.** An earlier draft told the engineer to add `<FrameworkReference Include="Microsoft.AspNetCore.App" />`. It is ALREADY declared explicitly at line 51 of that file. Adding a second is a duplicate MSBuild item, and CI builds with `/warnaserror`. Verified 2026-08-30 — do not re-add it.

**Frontend** — **No frontend changes, and no frontend degradation.** `statusCode` is preserved, so the `AdminOpsPage.tsx:69-72` status badge keeps rendering. `dtos.ts:569-576` declares `OpsErrorEventDto` as a hand-written TS interface; extra JSON keys from the widened C# record are ignored at runtime and cause no TS error. The console *displaying* the new fields is a later plan; this plan stops at the API boundary. `eventSchema.ts` needs no change — the `event-vocabulary-parity` CI gate compares event **names** only and lists `api.error` in its `SERVER_ONLY` set.

**Cross-cutting** — No secrets. No prod infra. No AI prompt change, so no golden-set delta. No SharedKernel type or event added or changed. **One `_COFOUNDER/` change:** `ADR-2026-05-02_event-vocabulary.md` lines 31 and 41 must be amended, because that ADR is the named source of truth for the `api.error` contract this plan reverses (`EventVocabulary.cs:12-15`). `_COFOUNDER/` is a separate nested git repo — it gets its **own commit in its own repo**, never mixed with app code (Task 6, Step 7).

---

### Task 0: Land the spec

**Files:**
- Create: `_COFOUNDER/specs/_active/2026-08-30-error-capture-engine.md`

**Why this is a task and not a preamble:** the plan previously pointed at a spec path that does not exist and told its own executor to "copy it there before execution if it still lives in the session scratchpad". Oath 1 is *no spec, no PR*, and the project Definition of Done requires a referenced spec. A plan may not instruct its executor to conjure its own authority.

- [x] **Step 1: Write the spec file with exactly this content**

    # Spec: Error Capture Engine — scope and locked decisions

    **ID:** 2026-08-30-error-capture-scope
    **Date:** 2026-08-30
    **Status:** active
    **Plan:** docs/superpowers/plans/2026-08-30-error-capture-engine.md

    ## Problem

    A recorded API failure carries only `endpoint`, `status` and `farmId`. The
    error's own name — which the handler knew, and which travels correctly all
    the way to the client — is discarded at the moment of recording. A developer
    looking at a `500` has to reverse-engineer what broke.

    ## Scope

    1. An error names itself in the recorded row (`errorCode`).
    2. The row states whether the farmer's work survived (`workKept`).
    3. The row carries which app build the farmer was on (`appVersion`).
    4. Every catalogued error has a plain-language explanation, enforced by a test.
    5. Unhandled exceptions are recorded too, by exception type name.
    6. The admin API surfaces all of the above.

    ## Locked founder decisions (2026-08-30)

    - **D1.** `errorCode` and `workKept` are REQUIRED on every `api.error`. An
      error that cannot name itself is a build failure.
    - **D2.** `workKept` is three-state: `kept` / `lost` / `unknown`. Required
      means it must be STATED, never that it must be KNOWN. Inferring `kept` is
      forbidden (doctrine P4). Inferring `lost` from a status code is equally
      forbidden — several 409s fire precisely because the work WAS stored.
      `lost` is recorded only when refused work was observed.
    - **D3.** No behaviour change is permitted in order to gain capture: no
      status code and no response body may change on any endpoint. Where an
      edit is unavoidable it must be behaviour-preserving by construction AND
      guarded by a test that fails if it is applied incompletely or regressed.
    - **D4.** Never farmer content in analytics props. `analytics.events` is
      append-only, so anything written there is unscrubbable. Codes and authored
      text only. No exception messages, no stack traces, no raw
      `Error.Description`.
    - **D5.** Existing consumers of `analytics.events` must not break.
      `statusCode` keeps its name.

    ## Out of scope

    - Rendering the new fields in the admin console (later plan).
    - Adding `api.slow` / `sync.mutation_rejected` to the frozen event
      vocabulary (needs its own ADR).
    - Converting the 27 duplicated endpoint error mappers onto one shared
      mapper (a wire-contract change; APK v1.0.9 is in the field).

- [x] **Step 2: Commit**

```bash
git add _COFOUNDER/specs/_active/2026-08-30-error-capture-engine.md
git commit -m "docs(spec): error capture engine scope and locked decisions

Every commit in this plan references this ID. It did not exist; the plan
pointed at a path and told its executor to produce it, which is not a spec."
```

---

### Task 1: The stamping wrapper

**Files:**
- Modify: `src/AgriSync.BuildingBlocks/Analytics/RequestObservabilityKeys.cs`
- Create: `src/AgriSync.BuildingBlocks/Results/ErrorCapture.cs`
- Modify: `src/AgriSync.BuildingBlocks/Results/ErrorHttpExtensions.cs`
- Modify: `src/tests/AgriSync.BuildingBlocks.Tests/Results/ErrorHttpExtensionsTests.cs`

**Interfaces:**
- Consumes: `Error(string Code, string Description, ErrorKind Kind = ErrorKind.Internal)` (`Error.cs:42`); `ProblemDetailsMapper.From(Error)` (`ProblemDetailsMapper.cs:27`).
- Produces: `ErrorCapture.Stamp(Error, IResult) -> IResult`; the public `CapturedErrorResult`; `RequestObservabilityKeys.ErrorCode`; `RequestObservabilityKeys.UnhandledExceptionType`. Tasks 2, 4 and 5 consume these.

**Why a wrapper and not a parameter.** `ToErrorResult` / `ToHttpResult` have no `HttpContext`. `IResult.ExecuteAsync(HttpContext)` receives one from the framework. Wrapping an already-built `IResult` and delegating to it means the status code and the response body it writes are **identical by construction** — the wrapper cannot change them because it does not build them.

**Why `CapturedErrorResult` is public, not private.** The Task 2 architecture test asserts that every mapper returns one. A private nested class cannot be asserted against from another assembly.

- [x] **Step 1: Add the two keys**

In `RequestObservabilityKeys.cs`, after the existing `RejectedWorkReason` constant (line 44) and inside the class:

```csharp
    /// <summary>
    /// <c>string</c> — the <c>Error.Code</c> of the catalogued failure that
    /// produced this response, e.g. <c>ShramSafal.CropCycleOverlap</c>. Stamped
    /// by <see cref="AgriSync.BuildingBlocks.Results.ErrorCapture"/> when the
    /// result executes; read by <c>RequestObservabilityMiddleware</c>. Its
    /// absence on a 4xx/5xx means the response was not produced from a
    /// catalogued Error, which is recorded honestly as "Uncatalogued" rather
    /// than guessed at.
    /// </summary>
    public const string ErrorCode = "observability.error_code";

    /// <summary>
    /// <c>string</c> — the runtime type NAME of an exception that escaped the
    /// endpoint, e.g. <c>NullReferenceException</c>. Set by
    /// <c>RequestObservabilityMiddleware</c> itself on the catch path.
    ///
    /// A type name is a code, so it passes the props privacy rule. The
    /// exception MESSAGE is deliberately NOT captured and must never be added
    /// here: a Postgres error text, a serializer message or a validation
    /// message can carry the request payload, and analytics.events is
    /// append-only (DO INSTEAD NOTHING on UPDATE/DELETE), so a farmer's words
    /// written there could never be scrubbed.
    /// </summary>
    public const string UnhandledExceptionType = "observability.unhandled_exception_type";
```

- [x] **Step 2: Create the capture wrapper**

Create `src/AgriSync.BuildingBlocks/Results/ErrorCapture.cs`:

```csharp
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Results;

/// <summary>
/// Records the identity of a failure on the request so
/// <c>RequestObservabilityMiddleware</c> can name it, without changing one byte
/// of what the client receives.
///
/// <para>
/// <b>Why a delegating wrapper.</b> An endpoint's error mapper has the
/// <see cref="Error"/> in hand but no <c>HttpContext</c>; the middleware has
/// the context but not the Error. <see cref="IResult.ExecuteAsync"/> is the one
/// place both exist. Wrapping an ALREADY-BUILT result and delegating to it
/// means the status code and the response body cannot change — this type does
/// not construct them.
/// </para>
///
/// <para>
/// <b>Why not collapse the 27 endpoint mappers onto one shared mapper instead.</b>
/// They do not agree, and the differences are load-bearing. Ten map by
/// <c>ErrorKind</c>; the rest map by string suffix
/// (<c>error.Code.EndsWith("NotFound")</c>). Most return
/// <c>{ error, message }</c>, two return a bare string, and nineteen answer a
/// Forbidden error with <c>Results.Forbid()</c> — no body at all.
/// <c>ShramSafal.CropCycleOverlap</c> is 400 under LogsEndpoints today and
/// would become 409 under a Kind-based mapper. APK v1.0.9 / versionCode 17 is
/// in the field and bundles its assets at build time, so it cannot be updated
/// in step with the server (<c>P11</c>). Converging those mappers is a
/// wire-contract change and belongs in its own plan with its own client story.
/// </para>
/// </summary>
public static class ErrorCapture
{
    /// <summary>
    /// Wraps <paramref name="inner"/> so that executing it also records
    /// <paramref name="error"/>'s code on <c>HttpContext.Items</c>.
    /// </summary>
    public static IResult Stamp(Error error, IResult inner)
    {
        ArgumentNullException.ThrowIfNull(error);
        ArgumentNullException.ThrowIfNull(inner);
        return new CapturedErrorResult(error, inner);
    }
}

/// <summary>
/// An <see cref="IResult"/> that stamps the error's code on the request and
/// then delegates verbatim to the result the endpoint actually built.
///
/// Public rather than private so <c>ErrorCaptureCoverageTests</c> can assert
/// that every endpoint error mapper in ShramSafal.Api returns one. That test is
/// what turns "someone added a 28th mapper and forgot to stamp it" from a
/// silent gap into a red build.
/// </summary>
public sealed class CapturedErrorResult : IResult
{
    public CapturedErrorResult(Error error, IResult inner)
    {
        Error = error;
        Inner = inner;
    }

    /// <summary>The catalogued error whose identity is being recorded.</summary>
    public Error Error { get; }

    /// <summary>The untouched result the endpoint built. Status and body come from here.</summary>
    public IResult Inner { get; }

    public Task ExecuteAsync(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        httpContext.Items[RequestObservabilityKeys.ErrorCode] = Error.Code;

        return Inner.ExecuteAsync(httpContext);
    }
}
```

- [x] **Step 3: Route the shared mapper through it**

Replace the body of `ErrorHttpExtensions.ToHttpResult` (`ErrorHttpExtensions.cs:17-28`). Keep the existing fully-qualified `Results.Problem` call and its comment — the namespace collision it guards against is real.

```csharp
    public static IResult ToHttpResult(this Error error)
    {
        var problem = ProblemDetailsMapper.From(error);
        // Fully qualified — local namespace is also "Results" so the
        // unqualified `Results.Problem(...)` resolves to this namespace
        // (CS0234) without it.
        var response = Microsoft.AspNetCore.Http.Results.Problem(
            detail: problem.Detail,
            statusCode: problem.Status,
            title: problem.Title,
            type: problem.Type);

        // Same RFC 7807 response as before, now carrying its own identity to
        // the observability middleware. One production caller today
        // (Accounts SubscriptionWebhookEndpoints.cs:122) — the farmer-facing
        // surface is covered by Task 2.
        return ErrorCapture.Stamp(error, response);
    }
```

- [x] **Step 4: Update the two pre-existing tests — they DO change**

`ErrorHttpExtensionsTests.cs:31` and `:43` use `Assert.IsType<ProblemHttpResult>(result)`, which is an **exact**-type assertion, not assignable-to. Wrapping the result fails all 7 cases (6 Theory rows + 1 Fact). Replace both test bodies. Every existing assertion is preserved — they now run against `.Inner` — plus a new test that the code was stamped. The file uses raw xUnit `Assert.*` (project convention: no FluentAssertions dependency in this project); keep it that way.

```csharp
    [Theory]
    [InlineData(ErrorKind.Validation, 400)]
    [InlineData(ErrorKind.Unauthenticated, 401)]
    [InlineData(ErrorKind.Forbidden, 403)]
    [InlineData(ErrorKind.NotFound, 404)]
    [InlineData(ErrorKind.Conflict, 409)]
    [InlineData(ErrorKind.Internal, 500)]
    public void ToHttpResult_yields_ProblemHttpResult_with_correct_status(ErrorKind kind, int expectedStatus)
    {
        var error = new Error("Sample.Code", "Sample description.", kind);

        var result = error.ToHttpResult();

        // 2026-08-30: the result is now wrapped so it can record the error's
        // identity on HttpContext.Items. The wrapper delegates verbatim, so
        // every assertion below is unchanged — it just reads through .Inner.
        var captured = Assert.IsType<CapturedErrorResult>(result);
        var problem = Assert.IsType<ProblemHttpResult>(captured.Inner);
        Assert.Equal(expectedStatus, problem.StatusCode);
        Assert.Equal("Sample.Code", problem.ProblemDetails.Title);
        Assert.Equal("Sample description.", problem.ProblemDetails.Detail);
        Assert.Equal($"{ProblemDetailsMapper.ProblemTypeBase}/Sample.Code", problem.ProblemDetails.Type);
    }

    [Fact]
    public void ToHttpResult_with_Validation_factory_yields_400()
    {
        var error = Error.Validation("Sample.Bad", "Field required.");
        var result = error.ToHttpResult();
        var captured = Assert.IsType<CapturedErrorResult>(result);
        var problem = Assert.IsType<ProblemHttpResult>(captured.Inner);
        Assert.Equal(400, problem.StatusCode);
    }

    [Fact]
    public async Task ToHttpResult_stashes_the_error_code_on_the_context()
    {
        var ctx = new DefaultHttpContext
        {
            Response = { Body = new MemoryStream() },
            RequestServices = new ServiceCollection()
                .AddLogging()
                .AddProblemDetails()
                .BuildServiceProvider(),
        };
        var error = Error.Conflict(
            "ShramSafal.CropCycleOverlap",
            "Crop cycle dates overlap an existing cycle on this plot.");

        await error.ToHttpResult().ExecuteAsync(ctx);

        Assert.Equal(
            "ShramSafal.CropCycleOverlap",
            ctx.Items[RequestObservabilityKeys.ErrorCode]);
        Assert.Equal(409, ctx.Response.StatusCode);
    }
```

Add these usings to the top of that file:

```csharp
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.Extensions.DependencyInjection;
```

`ProblemHttpResult.ExecuteAsync` resolves `IProblemDetailsService` and a logger from `RequestServices`, which is why the third test supplies one. `AgriSync.BuildingBlocks.Tests` already references `Microsoft.Extensions.DependencyInjection` and `Microsoft.Extensions.Logging` — no package is added.

- [x] **Step 5: Run the suite**

Run: `dotnet test src/tests/AgriSync.BuildingBlocks.Tests/`
Expected: PASS — 8 cases in `ErrorHttpExtensionsTests` (6 Theory + 2 Fact), `ErrorKindTests` untouched.

- [x] **Step 6: Commit**

```bash
git add src/AgriSync.BuildingBlocks/Analytics/RequestObservabilityKeys.cs \
        src/AgriSync.BuildingBlocks/Results/ErrorCapture.cs \
        src/AgriSync.BuildingBlocks/Results/ErrorHttpExtensions.cs \
        src/tests/AgriSync.BuildingBlocks.Tests/Results/ErrorHttpExtensionsTests.cs
git commit -m "feat(observability): carry the error code to the request context

spec: error-capture-engine

An Error already knows its own name, but nothing recorded it: the mapper has
the Error and no HttpContext, the middleware has the context and no Error.
A delegating IResult wrapper is where both exist, and because it wraps an
already-built result it cannot change the status or the body."
```

---

### Task 2: Apply capture to all 27 farmer-facing mappers, and gate it

**Files:**
- Modify: the 27 files listed in Step 4, all under `src/apps/ShramSafal/ShramSafal.Api/Endpoints/`
- Create: `src/tests/AgriSync.ArchitectureTests/ErrorCaptureCoverageTests.cs`

**Interfaces:**
- Consumes: `ErrorCapture.Stamp` and `CapturedErrorResult` from Task 1.
- Produces: nothing consumed downstream at compile time. This is where the error identity actually starts reaching the middleware for real traffic.

**Measured coverage this task delivers.** 27 of 27 private `Error -> IResult` mappers in `ShramSafal.Api`, plus the single shared `ToHttpResult` caller in `Accounts.Api`, plus unhandled exceptions via Task 5.

**NOT covered — stated plainly rather than implied.**

1. **The whole authentication surface, including login.** `User.Api/Endpoints/AuthEndpoints.cs` builds its failure responses inline and never crosses a shared mapper: line 62 is `Results.BadRequest(new { error = result.Error.Code, message = result.Error.Description })` — it *has* the catalogued code and discards it; line 97 is a bare `Results.Unauthorized()`; lines 39 and 128 are `Results.ValidationProblem`. Verified 2026-08-30.

   **Why this matters more than the count suggests:** a farmer who cannot log in is the hardest support case there is, and it is the one this plan leaves invisible. Every funnel number starts after login, so the farmer who never got in appears nowhere. This is the same surface as the open OTP dev-stub concern.

   ⚠️ **And stamping alone will not be enough.** `/user/auth/*` matches none of the middleware's
   `CriticalPathFragments` (`/logs`, `/sync/push`, `/ai/parse-voice`, `/ai/extract`, `/schedule/*`,
   `/farms`, `/verif`), so a 4xx login failure produces **no analytics row at all** — stamped or
   not. The follow-up plan must widen that list as well as stamp the endpoints, or it will ship and
   change nothing. Verified 2026-08-30.

   **Not fixed here, deliberately.** `User.Api` has no shared error mapper to hook, so covering it is its own scoped change, not a line in this plan. It gets a follow-up plan and must not be forgotten because this one shipped.

2. **Responses ASP.NET Core produces before any endpoint runs** — model-binding 400s, authentication 401s, rate-limiter 429s. These have no catalogued `Error` at all and are recorded honestly as `Uncatalogued`. Inventing a code for them would be the fabrication this plan exists to end.

**The transformation.** Identical in every file, and behaviour-preserving by construction:

1. Rename the existing method `ToErrorResult` to `MapErrorResult`. **Do not touch its body.** Not one status code, not one body shape, not one branch.
2. Add a new `ToErrorResult` above it that stamps and delegates.

None of the ~161 `ToErrorResult(...)` call sites change — the name they call still exists with the same signature.

Worked example, `LogsEndpoints.cs:236` (a suffix-heuristic mapper; body preserved verbatim):

```csharp
    /// <summary>
    /// 2026-08-30 — records the error's identity for the observability
    /// middleware, then returns exactly what MapErrorResult built. The mapping
    /// below is deliberately unchanged: this endpoint's status codes are part
    /// of the wire contract APK v1.0.9 already depends on.
    /// </summary>
    private static IResult ToErrorResult(Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
```

Worked example, `ReportEndpoints.cs:38` (an expression-bodied mapper — same rule, the body moves to `MapErrorResult`):

```csharp
    private static IResult ToErrorResult(Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(Error error) =>
        error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : error.Code.EndsWith("Forbidden", StringComparison.Ordinal)
                ? Results.Forbid()
                : Results.BadRequest(new { error = error.Code, message = error.Description });
```

`ScheduleTemplateEndpoints.cs:137` declares its parameter fully qualified (`AgriSync.BuildingBlocks.Results.Error error`). Keep that spelling in both methods there.

Each file needs `using AgriSync.BuildingBlocks.Results;`. Most already have it because they name `Error` unqualified. `ScheduleTemplateEndpoints.cs` does not — add it there, or fully qualify `ErrorCapture` too.

- [x] **Step 1: Write the failing gate first**

Create `src/tests/AgriSync.ArchitectureTests/ErrorCaptureCoverageTests.cs`:

```csharp
using System.Reflection;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// The founder constraint behind this test (2026-08-30, spec
/// 2026-08-30-error-capture-scope D3): a capture mechanism that has to be
/// applied by hand in many places will be applied incompletely, and the gap
/// will reappear silently.
///
/// <para>
/// ShramSafal.Api carries 27 duplicated private error mappers. They cannot be
/// collapsed into one — see the reasoning on <see cref="ErrorCapture"/> — so
/// each was wrapped instead. This test is what makes "someone added a 28th and
/// forgot" a red build rather than a silent hole in production observability.
/// </para>
///
/// <para>
/// It does NOT match on the method name: a future mapper called
/// <c>ToProblem</c> or <c>Fail</c> is caught too, because the test enumerates
/// by SIGNATURE — every static method in the assembly taking a single
/// <see cref="Error"/> and returning an
/// <see cref="Microsoft.AspNetCore.Http.IResult"/>. The inner
/// <c>MapErrorResult</c> halves are excluded by name because they are
/// deliberately unstamped: they are what the stamped entry point delegates to.
/// </para>
/// </summary>
public sealed class ErrorCaptureCoverageTests
{
    private const int KnownMapperCount = 27;

    private static IReadOnlyList<MethodInfo> ErrorMapperEntryPoints()
    {
        var assembly = Assembly.Load("ShramSafal.Api");

        return assembly
            .GetTypes()
            .SelectMany(t => t.GetMethods(
                BindingFlags.Public | BindingFlags.NonPublic |
                BindingFlags.Static | BindingFlags.DeclaredOnly))
            .Where(m => m.ReturnType == typeof(Microsoft.AspNetCore.Http.IResult))
            .Where(m =>
            {
                var ps = m.GetParameters();
                return ps.Length == 1 && ps[0].ParameterType == typeof(Error);
            })
            .Where(m => m.Name != "MapErrorResult")
            .ToList();
    }

    [Fact]
    public void The_endpoint_error_mappers_are_all_still_there()
    {
        // A drop in this number means a mapper was deleted or renamed past the
        // signature filter. Change it deliberately, never to turn a red test green.
        ErrorMapperEntryPoints().Should().HaveCount(KnownMapperCount,
            "ShramSafal.Api declared exactly 27 private Error->IResult entry points on "
            + "2026-08-30; adding or removing one is a deliberate act that must be "
            + "reviewed, not absorbed");
    }

    [Theory]
    [InlineData("Probe.NotFound", ErrorKind.NotFound)]
    [InlineData("Probe.Forbidden", ErrorKind.Forbidden)]
    [InlineData("Probe.RoleNotAllowed", ErrorKind.Forbidden)]
    [InlineData("Probe.Conflict", ErrorKind.Conflict)]
    [InlineData("Probe.Invalid", ErrorKind.Validation)]
    [InlineData("Probe.Boom", ErrorKind.Internal)]
    [InlineData("join.phone_not_verified", ErrorKind.Forbidden)]
    [InlineData("ShramSafal.WeatherProviderUnavailable", ErrorKind.Internal)]
    public void Every_endpoint_error_mapper_records_the_error_it_is_answering(
        string code, ErrorKind kind)
    {
        var probe = new Error(code, "Probe description.", kind);

        var unstamped = new List<string>();

        foreach (var mapper in ErrorMapperEntryPoints())
        {
            var produced = mapper.Invoke(null, new object?[] { probe });

            if (produced is not CapturedErrorResult)
            {
                unstamped.Add($"{mapper.DeclaringType!.FullName}.{mapper.Name}");
            }
        }

        unstamped.Should().BeEmpty(
            "an error mapper that does not stamp its Error leaves every failure it answers "
            + "recorded as 'Uncatalogued', which is the reverse-engineering problem this "
            + "plan exists to end. Wrap the body: `private static IResult "
            + "ToErrorResult(Error e) => ErrorCapture.Stamp(e, MapErrorResult(e));`");
    }
}
```

- [x] **Step 2: No project-file change is needed — do not make one**

An earlier draft told you to add `<FrameworkReference Include="Microsoft.AspNetCore.App" />` here.
**Do not.** It is already declared at line 51 of that csproj, and a second one fails at *restore*
with `NETSDK1087: Multiple FrameworkReference items ... were included` — before anything compiles.

Verified 2026-08-30 by building the project: `ShramSafal.Api.dll` is already present in
`bin/Debug/net10.0/` and in the project's `.deps.json`, so `Assembly.Load("ShramSafal.Api")`
resolves with no project-file change at all. Move straight to Step 3.

- [x] **Step 3: Run it and confirm it fails**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ErrorCaptureCoverage"`
Expected: FAIL — `The_endpoint_error_mappers_are_all_still_there` passes (27 found), and `Every_endpoint_error_mapper_records_the_error_it_is_answering` fails listing all 27 type/method names. **That list is the executor's worklist for Step 4**, and it shrinks by one with every file done.

- [x] **Step 4: Apply the transformation to all 27 files**

Same two-step edit in each. Tick each as its build compiles.

- [x] `AiEndpoints.cs:1526`
- [x] `AttachmentEndpoints.cs:287`
- [x] `AttentionEndpoints.cs:39`
- [x] `ComplianceEndpoints.cs:185`
- [x] `ConsentEndpoints.cs:106`
- [x] `ConsentGateEndpoints.cs:228` — expression-bodied; returns a **bare string** body (`Results.BadRequest(error.Description)`). Preserve that; do not "improve" it to `{ error, message }`.
- [x] `DataRightsEndpoints.cs:154`
- [x] `DfesEndpoints.cs:97`
- [x] `DfesQuestionEndpoints.cs:85` — expression-bodied; bare-string body. Same caution.
- [x] `FarmEndpoints.cs:310` — has a special-case 503 branch for `ShramSafal.WeatherProviderNotConfigured` / `ShramSafal.WeatherProviderUnavailable`. Preserve verbatim.
- [x] `FinanceEndpoints.cs:311`
- [x] `JobCardEndpoints.cs:315`
- [x] `LabourEndpoints.cs:270`
- [x] `LogsEndpoints.cs:236`
- [x] `MembershipEndpoints.cs:320`
- [x] `PiiReviewEndpoints.cs:120`
- [x] `PlannedActivityEndpoints.cs`
- [x] `PlanningEndpoints.cs:124`
- [x] `ReferenceDataEndpoints.cs`
- [x] `ReportEndpoints.cs:38` — expression-bodied.
- [x] `ScheduleEndpoints.cs`
- [x] `ScheduleTemplateEndpoints.cs:137` — fully-qualified `Error` parameter; needs the `using` or a fully-qualified `ErrorCapture`.
- [x] `SecurityEndpoints.cs`
- [x] `SyncEndpoints.cs:138`
- [x] `TestEndpoints.cs` — has a `RoleNotAllowed` suffix branch alongside `Forbidden`. Preserve verbatim.
- [x] `VoiceDiaryEndpoints.cs`
- [x] `WorkerProfileEndpoints.cs`

- [x] **Step 5: Run the gate and the whole backend suite**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/`
Expected: PASS, including `ErrorCaptureCoverageTests` and the pre-existing `DependencyRuleTests`.

Run: `dotnet test src/AgriSync.sln --filter "Category!=RequiresDocker"`
Expected: PASS. Any endpoint test asserting on a status code or a response body is the real check that the transformation was behaviour-preserving — if one goes red, a mapper body was edited and must be restored.

- [x] **Step 6: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Api/Endpoints/ \
        src/tests/AgriSync.ArchitectureTests/ErrorCaptureCoverageTests.cs
git commit -m "feat(observability): every error mapper records what it answered

spec: error-capture-engine

ToHttpResult had exactly one production caller; the 27 farmer-facing failures
went through duplicated private mappers that never saw an HttpContext. Each now
wraps its own unmodified body, so no status code and no response body changed —
APK v1.0.9 is in the field and cannot be updated in step. ErrorCaptureCoverageTests
enumerates by signature, so a 28th mapper that forgets to stamp fails the build."
```

---

### Task 3: The 58 explanations

**Files:**
- Create: `src/AgriSync.BuildingBlocks/Results/ErrorExplanations.cs`
- Create: `src/tests/AgriSync.ArchitectureTests/ErrorExplanationCoverageTests.cs`

**Interfaces:**
- Consumes: nothing at compile time. The map is keyed on **literal code strings**, so it does not — and must not — reference either catalogue.
- Produces: `ErrorExplanations.For(string? code) -> ErrorExplanation?`. Task 4 uses it to fill the recorded `message`; Task 8 uses it to fill `Meaning` / `UsualCause` on the admin DTO.

**Why BuildingBlocks and not `ShramSafal.Domain`.** It must cover both catalogues. `ShramSafal.Domain.csproj` references only SharedKernel and BuildingBlocks, and `DependencyRuleTests.ShramSafal_Domain_Does_Not_Depend_On_User_Domain` explicitly forbids adding `User.Domain` — as does the project rule "cross-context communication via SharedKernel events only". BuildingBlocks already owns `Error` and `ProblemDetailsMapper`, is referenced by both Domain projects and by `ShramSafal.Infrastructure`, and depends on neither. A *test* project may reference both catalogues; a *production* project may not.

**Why the test lives in `AgriSync.ArchitectureTests`.** It is the only test project that can see **both** `ShramSafalErrors` and `UserErrors` — it references `AgriSync.Bootstrapper`, which references `ShramSafal.Domain` and `User.Domain` directly. `ShramSafal.Domain.Tests` sees only ShramSafal, so a completeness test there would silently cover 52 of 58 and stay green with all 6 User errors unexplained.

**Codes are namespace-prefixed and NOT uniformly shaped.** Key on the literal `Error.Code`, never on a field name and never on a stripped suffix:
- `ShramSafalErrors.FarmNotFound` has code `"ShramSafal.FarmNotFound"` — 2 segments.
- `ShramSafalErrors.LabourAssignmentConflict` has code `"ShramSafal.LabourAssignment.Conflict"` — **3 segments, deliberately.** `ShramSafalErrors.cs:53-64` carries a 12-line comment: `RejectionPolicy.ts` `normalizeCode` keeps the tail after the LAST dot and upper-cases it, so this yields `CONFLICT`, which is already in `PERMANENT_REJECTION_CODES` in every client shipped since 2026-05-02. "DO NOT tidy this back to two segments without shipping a client first."
- `JoinUnauthenticated` / `JoinPhoneNotVerified` / `JoinInvalidPayload` have codes `"join.unauthenticated"`, `"join.phone_not_verified"`, `"join.invalid_payload"` — **no `ShramSafal.` prefix at all**, lower_snake, preserved verbatim because the frontend depends on them.
- `UserErrors.UserNotFound` has code `"User.NotFound"` and `UserErrors.UserDeactivated` has code `"User.Deactivated"` — field name and code **diverge**, so no mechanical derivation is possible either.

- [x] **Step 1: Write the failing test**

Create `src/tests/AgriSync.ArchitectureTests/ErrorExplanationCoverageTests.cs`:

```csharp
using System.Reflection;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Domain.Common;
using User.Domain.Common;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// A named error without a plain-language explanation forces the next person to
/// reverse-engineer it — the exact defect spec 2026-08-30-error-capture-scope
/// exists to end. This test is the enforcement: adding an error without
/// explaining it fails the build.
///
/// It enumerates BOTH catalogues on purpose. A version reflecting over
/// ShramSafalErrors alone would have gone green at 52 of 58, leaving every
/// User-context error unexplained and unnoticed.
/// </summary>
public sealed class ErrorExplanationCoverageTests
{
    private static IReadOnlyList<Error> AllCataloguedErrors() =>
        new[] { typeof(ShramSafalErrors), typeof(UserErrors) }
            .SelectMany(t => t.GetFields(BindingFlags.Public | BindingFlags.Static))
            .Where(f => f.FieldType == typeof(Error))
            .Select(f => (Error)f.GetValue(null)!)
            .ToList();

    [Fact]
    public void The_catalogue_is_the_size_we_think_it_is()
    {
        // 52 in ShramSafalErrors + 6 in UserErrors, measured 2026-08-30. If this
        // fails, an error was added or removed — go write its explanation, do
        // not just bump the number.
        AllCataloguedErrors().Should().HaveCount(58);
    }

    [Fact]
    public void Every_named_error_in_the_catalogue_has_an_explanation()
    {
        var missing = AllCataloguedErrors()
            .Select(e => e.Code)
            .Distinct(StringComparer.Ordinal)
            .Where(code => ErrorExplanations.For(code) is null)
            .OrderBy(c => c, StringComparer.Ordinal)
            .ToList();

        missing.Should().BeEmpty(
            "every catalogued error needs one plain sentence of meaning and one of usual "
            + "cause. Missing: " + string.Join(", ", missing));
    }

    [Fact]
    public void An_explanation_says_what_it_means_and_what_usually_causes_it()
    {
        // Keyed on the FULL code — codes are namespace-prefixed.
        var e = ErrorExplanations.For("ShramSafal.CropCycleOverlap");

        e.Should().NotBeNull();
        e!.Meaning.Should().NotBeNullOrWhiteSpace();
        e.UsualCause.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void An_uncatalogued_code_has_no_explanation_rather_than_a_guessed_one()
    {
        ErrorExplanations.For("Uncatalogued").Should().BeNull();
        ErrorExplanations.For("Nonsense.NotAThing").Should().BeNull();
        ErrorExplanations.For("").Should().BeNull();
        ErrorExplanations.For(null).Should().BeNull();
    }

    [Fact]
    public void The_irregular_codes_are_keyed_exactly_as_declared()
    {
        // Guards against a well-meaning "tidy". RejectionPolicy.ts in every
        // shipped client depends on the third segment of the first one, and the
        // join.* family carries no ShramSafal. prefix at all.
        ErrorExplanations.For("ShramSafal.LabourAssignment.Conflict").Should().NotBeNull();
        ErrorExplanations.For("join.phone_not_verified").Should().NotBeNull();
        ErrorExplanations.For("User.NotFound").Should().NotBeNull();
    }
}
```

- [x] **Step 2: Run and confirm it fails**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ErrorExplanationCoverage"`
Expected: FAIL — `ErrorExplanations` does not exist (compile error).

- [x] **Step 3: Create the file**

Create `src/AgriSync.BuildingBlocks/Results/ErrorExplanations.cs`:

```csharp
namespace AgriSync.BuildingBlocks.Results;

/// <param name="Meaning">What went wrong, in one plain sentence.</param>
/// <param name="UsualCause">What normally produces it — the first thing to check.</param>
public sealed record ErrorExplanation(string Meaning, string UsualCause);

/// <summary>
/// A plain-language explanation for every catalogued error. Written once, read
/// wherever the code appears — the recorded analytics row, the admin ops list,
/// and (later) the console. A code without an entry here fails
/// <c>ErrorExplanationCoverageTests</c>, which is deliberate: adding a named
/// error without explaining it recreates the problem this file was built to solve.
///
/// <para>
/// <b>Keys are the literal <c>Error.Code</c> string.</b> They are
/// namespace-prefixed, they are not uniformly shaped, and no key may be derived
/// from a field name. <c>ShramSafal.LabourAssignment.Conflict</c> has three
/// segments on purpose (ShramSafalErrors.cs:53-64 — RejectionPolicy.ts in every
/// shipped client depends on it). The <c>join.*</c> family carries no
/// <c>ShramSafal.</c> prefix at all. <c>UserErrors.UserNotFound</c> declares the
/// code <c>User.NotFound</c>. Read the code off the Error; do not infer it.
/// </para>
///
/// <para>
/// <b>Why this lives in BuildingBlocks.</b> It must cover both ShramSafal (52)
/// and User (6). ShramSafal.Domain may not reference User.Domain
/// (DependencyRuleTests.ShramSafal_Domain_Does_Not_Depend_On_User_Domain).
/// BuildingBlocks is referenced by both, references neither, and already owns
/// Error. It is keyed on strings precisely so it needs no reference back.
/// </para>
///
/// <para>
/// <b>Text authored here is the ONLY free text recorded into analytics props.</b>
/// analytics.events is append-only (DO INSTEAD NOTHING on UPDATE/DELETE), so
/// whatever lands there can never be scrubbed. Raw <c>Error.Description</c> is
/// NOT recorded, because descriptions are not uniformly static — several are
/// built with string interpolation. Nothing farmer-authored may appear below.
/// </para>
/// </summary>
public static class ErrorExplanations
{
    private static readonly Dictionary<string, ErrorExplanation> Map = new(StringComparer.Ordinal)
    {
        // ── ShramSafal — NotFound ────────────────────────────────────────────
        ["ShramSafal.FarmNotFound"] = new(
            "The farm this request names does not exist, or the caller cannot see it.",
            "A stale farm id on an older app build, or a request scoped to a farm the caller "
            + "is not a member of — check tenant scope before assuming the farm was deleted."),

        // ── ShramSafal — Conflict ────────────────────────────────────────────
        ["ShramSafal.CropCycleOverlap"] = new(
            "Two crop cycles claim the same plot over the same dates.",
            "A new cycle was started without closing the previous one, or two devices created "
            + "cycles while offline and both synced."),

        ["ShramSafal.DuplicateLogRequest"] = new(
            "This log was already recorded under the same idempotency key.",
            "The phone retried a sync it had in fact completed. Usually harmless — the "
            + "idempotency guard doing its job, not a farmer losing work."),

        ["ShramSafal.LabourAssignment.Conflict"] = new(
            "This labour entry is already recorded on another daily log.",
            "The client re-asserted a labour assignment id that is already the primary key of "
            + "a committed row on a different log. Permanent, not retryable — the phone parks "
            + "it for review. See the 2026-08-27 incident note in ShramSafalErrors.cs."),

        // ── ShramSafal — Forbidden ───────────────────────────────────────────
        ["ShramSafal.ConsentRequired"] = new(
            "The Full History Journal consent toggle is off, so this voice note cannot be retained.",
            "The farmer has not turned the toggle on in Settings. Not a bug — the frontend is "
            + "expected to render a consent CTA rather than an error."),

        // ── ShramSafal — Internal ────────────────────────────────────────────
        ["ShramSafal.WeatherProviderUnavailable"] = new(
            "The upstream weather service did not answer in time.",
            "A Tomorrow.io outage or a network timeout from the box. Transient — check the "
            + "provider's status before looking anywhere in our code."),

        // ── Memberships / ClaimJoin (codes carry no ShramSafal. prefix) ──────
        ["join.phone_not_verified"] = new(
            "The caller tried to join a farm before verifying their phone by OTP.",
            "A join link or QR scan opened while the account was still unverified. The client "
            + "should route to OTP verification, not surface this as a failure."),

        // ── User ─────────────────────────────────────────────────────────────
        ["User.NotFound"] = new(
            "No account exists for the identifier in this request.",
            "A stale user id held by an old client, or a login attempt for a phone number that "
            + "was never registered."),

        // Remaining entries follow, one per code, in the same shape and the same
        // section order as ShramSafalErrors.cs and UserErrors.cs.
    };

    /// <summary>
    /// The explanation for a code, or <c>null</c> if the code is not catalogued.
    /// Null is the honest answer for an uncatalogued failure — never a guess.
    /// </summary>
    public static ErrorExplanation? For(string? code)
        => code is not null && Map.TryGetValue(code, out var e) ? e : null;
}
```

- [x] **Step 4: Author the remaining 50 entries**

The 8 above are the shapes; below is the exhaustive list of remaining codes, verified verbatim from the two catalogue files on 2026-08-30.

**Do not enumerate them with a grep.** A line-oriented `grep -oE` misses every multi-line declaration — 12 of the 58, including **all six** `UserErrors` and `ShramSafalErrors` lines 65, 71, 78, 89, 102 and 121. This list *is* the enumeration. If it ever needs regenerating, run the failing test: `Every_named_error_in_the_catalogue_has_an_explanation` prints the exact missing list in its failure message, because it computes it from the same reflection the gate uses.

For each entry: the `Meaning` comes from the error's own `Description`, rewritten as one plain sentence — **do not paste the description**. The `UsualCause` comes from reading the handlers that return it: `grep -rn "ShramSafalErrors.<FieldName>" --include=*.cs src/apps`. **Do not paraphrase the description into the cause** — the cause is what a developer actually needs and the description does not contain it.

`ShramSafalErrors`, 45 remaining:

- [x] `ShramSafal.PlotNotFound`
- [x] `ShramSafal.CropCycleNotFound`
- [x] `ShramSafal.DailyLogNotFound`
- [x] `ShramSafal.PlannedActivityNotFound`
- [x] `ShramSafal.CostEntryNotFound`
- [x] `ShramSafal.DayLedgerNotFound`
- [x] `ShramSafal.AttachmentNotFound`
- [x] `ShramSafal.ScheduleTemplateNotFound`
- [x] `ShramSafal.ScheduleSubscriptionNotFound`
- [x] `ShramSafal.AttachmentAlreadyFinalized`
- [x] `ShramSafal.ScheduleAlreadyAdopted`
- [x] `ShramSafal.ScheduleTemplateUnpublished`
- [x] `ShramSafal.ScheduleNotActive`
- [x] `ShramSafal.Forbidden`
- [x] `ShramSafal.VerificationTransitionNotAllowedForRole`
- [x] `ShramSafal.LabourManagementCarriedByRole`
- [x] `ShramSafal.WorkerRecordPortabilityForbidden`
- [x] `ShramSafal.InvalidAmount`
- [x] `ShramSafal.InvalidVerificationReason`
- [x] `ShramSafal.MissingVoiceTranscript`
- [x] `ShramSafal.InvalidCommand`
- [x] `ShramSafal.CorrectionFieldTooLong`
- [x] `ShramSafal.ScheduleTemplateCropMismatch`
- [x] `ShramSafal.InvalidAiResponse`
- [x] `ShramSafal.AiParsingFailed`
- [x] `ShramSafal.TestProtocolNotFound`
- [x] `ShramSafal.TestInstanceNotFound`
- [x] `ShramSafal.TestRoleNotAllowed`
- [x] `ShramSafal.TestInvalidState`
- [x] `ShramSafal.TestAttachmentInvalid`
- [x] `ShramSafal.ComplianceSignalNotFound`
- [x] `ShramSafal.ComplianceSignalRoleNotAllowed`
- [x] `ShramSafal.ComplianceSignalInvalidState`
- [x] `ShramSafal.ComplianceSignalNoteRequired`
- [x] `ShramSafal.JobCardNotFound`
- [x] `ShramSafal.JobCardRoleNotAllowed`
- [x] `ShramSafal.JobCardWorkerNotMember`
- [x] `ShramSafal.JobCardInvalidState`
- [x] `ShramSafal.JobCardDailyLogMismatch`
- [x] `ShramSafal.JobCardActivityTypeMismatch`
- [x] `ShramSafal.UseSettleJobCardForLabourPayout`
- [x] `ShramSafal.FarmCentreMissing`
- [x] `ShramSafal.WeatherProviderNotConfigured`
- [x] `join.unauthenticated`
- [x] `join.invalid_payload`

`UserErrors`, 5 remaining:

- [x] `User.PhoneAlreadyRegistered`
- [x] `User.InvalidCredentials`
- [x] `User.Deactivated`
- [x] `User.InvalidRefreshToken`
- [x] `User.DuplicateMembership`

**Known-uncatalogued, deliberately excluded.** `GetAiJobStatusHandler.cs:13-14` declares `private static readonly Error AiJobNotFound = new("ShramSafal.AiJobNotFound", "AI job was not found.")` — a 53rd ShramSafal error that lives outside the catalogue and uses the two-argument constructor, so it defaults to `ErrorKind.Internal` (500) despite being a not-found. It is **not** part of the 58 and this plan does not move it: relocating it would change its HTTP status from 500 to 404, a wire-contract change that belongs with the mapper-convergence work. Recorded here so the figure "58" is honest.

- [x] **Step 5: Run until nothing is missing**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ErrorExplanationCoverage"`
Expected: PASS, all five facts.

- [x] **Step 6: Commit**

```bash
git add src/AgriSync.BuildingBlocks/Results/ErrorExplanations.cs \
        src/tests/AgriSync.ArchitectureTests/ErrorExplanationCoverageTests.cs
git commit -m "feat(errors): plain-language explanation for every catalogued error

spec: error-capture-engine

58 codes across both catalogues, keyed on the literal Error.Code — they are
namespace-prefixed, one has three segments on purpose and the join.* family
has no prefix at all, so no key can be derived from a field name. The
coverage test enumerates BOTH catalogues, so a new error without an
explanation fails the build rather than covering 52 of 58 quietly."
```

---

### Task 4: Build the props bag, honestly

**Files:**
- Create: `src/AgriSync.BuildingBlocks/Analytics/RequestObservabilityProps.cs`
- Create: `src/tests/AgriSync.BuildingBlocks.Tests/Analytics/RequestObservabilityPropsTests.cs`

**Interfaces:**
- Consumes: `RequestObservabilityKeys.ErrorCode` (Task 1); `ErrorExplanations.For` (Task 3).
- Produces: `RequestObservabilityProps.Build(...)` returning the **complete** props dictionary. Task 5 serializes exactly what this returns and merges nothing afterwards; Task 7 asserts the vocabulary accepts it.

**Why `Build` returns the whole bag and the middleware merges nothing.** An earlier design had the middleware build a base bag and then add four more keys. A parity test over the base bag would then be asserting on a dictionary literal three lines above it while the real payload — the merged one — went unchecked, and a merge that dropped or overrode a required key would stay green. One method, one bag, one thing to test.

**Why only `api.error` gets the new keys.** `RequestObservabilityMiddleware.cs:87-91` picks one of three event types and serializes one bag for whichever won. An `api.slow` row is a **successful** request that was merely slow; stamping it `errorCode: "Uncatalogued"` and giving it a `workKept` verdict would be noise in the ops list and a claim about work nothing observed. `sync.mutation_rejected` was deliberately separated from `api.error` (`AnalyticsEventType.cs:58-71` — one farmer re-syncing 31 refused mutations would otherwise have paged the founder about an API failure while the API was healthy) and must not be blurred back together at the props layer. Neither is in the frozen 13-name registry, so nothing documents their shape — a pre-existing gap, stated here and out of scope.

**How `workKept` is decided — state it, never guess it:**

| Condition (evaluated in this order) | Value | Why |
|---|---|---|
| `rejectedWorkItems > 0` | `"lost"` | The endpoint itself counted work it refused. **Observed, not inferred.** |
| anything else | `"unknown"` | We do not know, and saying so is the only honest answer. |

`"kept"` is defined as a constant and **never produced by this method**. Only a handler that actually stored something may assert it, by stamping the context itself in a later plan.

`"lost"` is *not* inferred from a 4xx or a 5xx. `ShramSafal.DuplicateLogRequest`, `ShramSafal.ScheduleAlreadyAdopted`, `ShramSafal.AttachmentAlreadyFinalized` and `ShramSafal.LabourAssignment.Conflict` are all 409s that fire **because the work was already stored**, and `POST /sync/push` answers 200 while refusing items inside it (`RequestObservabilityKeys.cs:8-14`), so a status code says nothing about durability in either direction. Recording `lost` there would be a fabricated fact under `P4` — and worse than a missing one, because it would be read as evidence a farmer lost a day's work.

- [x] **Step 1: Write the failing tests**

Create `src/tests/AgriSync.BuildingBlocks.Tests/Analytics/RequestObservabilityPropsTests.cs`. **Raw xUnit `Assert.*`** — `AgriSync.BuildingBlocks.Tests` has no FluentAssertions reference and that is a documented convention (`ConsentEnforcerTests.cs:5-6`).

```csharp
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Analytics;

/// <summary>
/// The props bag is built here rather than inline in the middleware so its
/// contract can be asserted directly: the middleware writes through
/// IAnalyticsWriter and never passes IngestEventsValidator, so nothing else
/// checks it at runtime.
/// </summary>
public sealed class RequestObservabilityPropsTests
{
    private static DefaultHttpContext Ctx(string method, string path, int status)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = method;
        ctx.Request.Path = path;
        ctx.Response.StatusCode = status;
        return ctx;
    }

    [Fact]
    public void An_api_error_reports_the_code_the_endpoint_actually_answered()
    {
        var ctx = Ctx("POST", "/shramsafal/logs", 409);
        ctx.Request.Headers["X-App-Version"] = "1.0.9";
        ctx.Items[RequestObservabilityKeys.ErrorCode] = "ShramSafal.CropCycleOverlap";

        var props = RequestObservabilityProps.Build(
            ctx,
            eventType: AnalyticsEventType.ApiError,
            status: 409,
            latencyMs: 42,
            rejectedWorkItems: null,
            rejectedWorkReason: null,
            farmId: null,
            traceId: "trace-1",
            unhandledExceptionType: null);

        Assert.Equal("ShramSafal.CropCycleOverlap", props["errorCode"]);
        Assert.Equal("1.0.9", props["appVersion"]);
        Assert.Equal("POST /shramsafal/logs", props["endpoint"]);
        Assert.Equal(409, props["statusCode"]);
        // Authored text from the explanation catalogue — never the raw
        // Error.Description, which is interpolated in several places.
        Assert.Equal(
            "Two crop cycles claim the same plot over the same dates.",
            props["message"]);
    }

    [Fact]
    public void The_key_three_live_SQL_readers_use_is_statusCode_not_status()
    {
        var ctx = Ctx("GET", "/shramsafal/farms", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null);

        // AdminOpsRepository.cs:99, AdminOpsRepository.cs:226 and
        // AdminFarmerHealthRepository.cs:367 all read props->>'statusCode'.
        // On an absent key Postgres yields NULL, not an error, and both
        // repositories swallow — so a rename here would degrade the admin
        // console silently. Renaming needs its own plan and a reader migration.
        Assert.True(props.ContainsKey("statusCode"));
        Assert.False(props.ContainsKey("status"));
    }
}
```

…and these six further facts **in the same class**, above its closing brace:

```csharp
    [Fact]
    public void An_unknown_outcome_is_stated_as_unknown_and_never_as_kept()
    {
        var ctx = Ctx("GET", "/shramsafal/farms", 500);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 10, null, null, null, "t", null);

        Assert.Equal("unknown", props["workKept"]);
        Assert.Equal("Uncatalogued", props["errorCode"]);
        Assert.Null(props["message"]);
    }

    [Fact]
    public void A_failed_write_is_unknown_not_lost_because_several_409s_mean_it_was_stored()
    {
        // ShramSafal.DuplicateLogRequest is a 409 that fires BECAUSE the log
        // already exists. Recording "lost" here would be a fabricated fact (P4)
        // read as evidence a farmer lost a day's work.
        var ctx = Ctx("POST", "/shramsafal/logs", 409);
        ctx.Items[RequestObservabilityKeys.ErrorCode] = "ShramSafal.DuplicateLogRequest";

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 409, 5, null, null, null, "t", null);

        Assert.Equal("unknown", props["workKept"]);
    }

    [Fact]
    public void Work_is_reported_lost_only_when_refused_work_was_actually_counted()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 200, 900, 3, "sync.mutation_rejected", null, "t", null);

        Assert.Equal("lost", props["workKept"]);
        Assert.Equal(3, props["rejectedWorkItems"]);
        Assert.Equal("sync.mutation_rejected", props["rejectedWorkReason"]);
    }

    [Fact]
    public void An_unhandled_exception_names_its_type_and_never_its_message()
    {
        var ctx = Ctx("POST", "/shramsafal/logs", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiError, 500, 12, null, null, null, "t",
            unhandledExceptionType: "NullReferenceException");

        Assert.Equal("Exception:NullReferenceException", props["errorCode"]);
        Assert.Equal(500, props["statusCode"]);
        Assert.Null(props["message"]);
        Assert.False(props.ContainsKey("exceptionMessage"));
    }

    [Fact]
    public void A_slow_but_successful_request_is_not_given_an_error_identity()
    {
        var ctx = Ctx("POST", "/shramsafal/logs", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.ApiSlow, 200, 3100, null, null, null, "t", null);

        // api.slow SUCCEEDED. Calling it "Uncatalogued" would be noise in the
        // ops list, and a workKept verdict would be a claim nothing observed.
        Assert.False(props.ContainsKey("errorCode"));
        Assert.False(props.ContainsKey("workKept"));
        Assert.False(props.ContainsKey("message"));
        // The pre-existing shape is untouched for this event type.
        Assert.Equal("POST /shramsafal/logs", props["endpoint"]);
        Assert.Equal(200, props["statusCode"]);
        Assert.Equal(3100L, props["latencyMs"]);
    }

    [Fact]
    public void A_rejected_mutation_keeps_its_own_shape_and_is_not_blurred_into_api_error()
    {
        var ctx = Ctx("POST", "/shramsafal/sync/push", 200);

        var props = RequestObservabilityProps.Build(
            ctx, AnalyticsEventType.SyncMutationRejected, 200, 800, 2, "sync.mutation_rejected", null, "t", null);

        // AnalyticsEventType.cs:58-71 records why this type was separated from
        // api.error: one farmer re-syncing 31 refused mutations would have
        // paged the founder about an API failure while the API was healthy.
        Assert.False(props.ContainsKey("errorCode"));
        Assert.False(props.ContainsKey("workKept"));
        Assert.Equal(2, props["rejectedWorkItems"]);
    }
```

- [x] **Step 2: Run and confirm they fail**

Run: `dotnet test src/tests/AgriSync.BuildingBlocks.Tests/ --filter "FullyQualifiedName~RequestObservabilityProps"`
Expected: FAIL — `RequestObservabilityProps` does not exist (compile error).

- [x] **Step 3: Create the builder**

Create `src/AgriSync.BuildingBlocks/Analytics/RequestObservabilityProps.cs`:

```csharp
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Analytics;

/// <summary>
/// Builds the COMPLETE props bag for a row emitted by
/// <c>RequestObservabilityMiddleware</c>. Extracted from the middleware so the
/// contract can be asserted directly: the middleware writes through
/// <c>IAnalyticsWriter</c>, which bypasses <c>IngestEventsValidator</c>, so a
/// test over this method is what actually holds the vocabulary's required props.
///
/// <para>
/// It returns the WHOLE bag and the middleware merges nothing afterwards — a
/// post-hoc merge could drop or override a required key and every test would
/// stay green.
/// </para>
///
/// <para>
/// Privacy: codes and counts only, never farmer content
/// (RequestObservabilityMiddleware.cs:106). analytics.events is append-only, so
/// a mistake here is permanent. The only free text recorded is
/// <see cref="ErrorExplanations"/>' authored meaning — never a raw
/// <c>Error.Description</c> (several are interpolated, e.g.
/// Msg91SmsSender.cs:74) and never an exception message.
/// </para>
/// </summary>
public static class RequestObservabilityProps
{
    /// <summary>The farmer's work survived. Never inferred — only a handler that stored something may assert it.</summary>
    public const string Kept = "kept";

    /// <summary>Work was refused. Recorded only when the endpoint counted refused items.</summary>
    public const string Lost = "lost";

    /// <summary>We do not know. The honest default.</summary>
    public const string Unknown = "unknown";

    /// <summary>Used when a failure was not produced from a catalogued Error.</summary>
    public const string UncataloguedCode = "Uncatalogued";

    /// <summary>Prefix for a failure that came from an escaped exception rather than a catalogued Error.</summary>
    public const string ExceptionCodePrefix = "Exception:";

    public static Dictionary<string, object?> Build(
        HttpContext ctx,
        string eventType,
        int status,
        long latencyMs,
        int? rejectedWorkItems,
        string? rejectedWorkReason,
        Guid? farmId,
        string? traceId,
        string? unhandledExceptionType)
    {
        ArgumentNullException.ThrowIfNull(ctx);

        var props = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["endpoint"] = $"{ctx.Request.Method} {ctx.Request.Path}",

            // NOT "status". Three live SQL readers depend on this exact name —
            // AdminOpsRepository.cs:99, AdminOpsRepository.cs:226 and
            // AdminFarmerHealthRepository.cs:367 — and Postgres answers an
            // absent key with NULL rather than an error, so a rename would
            // degrade the admin console silently. The vocabulary's Optional
            // list said "status" for months while the emitter said
            // "statusCode"; the SQL follows the emitter. Doc fixed in Task 6.
            ["statusCode"] = status,

            ["latencyMs"] = latencyMs,
            ["traceId"] = traceId,

            // Duplicates the analytics.events.farm_id COLUMN deliberately: the
            // vocabulary lists farmId as an api.error prop, and a row read out
            // of props alone should be self-describing. The column stays
            // authoritative — AdminFarmerHealthRepository filters on farm_id.
            ["farmId"] = farmId,

            // Null on every pre-existing emit path, so existing consumers of
            // analytics.events are unaffected. Non-null means: the response
            // carried this many refused work items despite its status code.
            // Codes and counts only — never farmer content.
            ["rejectedWorkItems"] = rejectedWorkItems,
            ["rejectedWorkReason"] = rejectedWorkReason,
        };

        // api.slow is a request that SUCCEEDED and was merely slow;
        // sync.mutation_rejected is a product failure deliberately kept
        // distinct from an API failure (AnalyticsEventType.cs:58-71). Neither
        // has an error identity, and neither has a work outcome anyone
        // observed. Giving them one would be noise on the first and a
        // fabricated claim on both.
        if (!string.Equals(eventType, AnalyticsEventType.ApiError, StringComparison.Ordinal))
        {
            return props;
        }

        var errorCode =
            unhandledExceptionType is not null
                ? ExceptionCodePrefix + unhandledExceptionType
                : ctx.Items.TryGetValue(RequestObservabilityKeys.ErrorCode, out var raw)
                  && raw is string code
                  && code.Length > 0
                    ? code
                    : UncataloguedCode;

        props["errorCode"] = errorCode;

        // Stated, never guessed. "lost" requires that the endpoint counted
        // refused work; "kept" is never produced here at all. A 4xx or 5xx on a
        // write is NOT evidence of loss — ShramSafal.DuplicateLogRequest and
        // three sibling 409s fire precisely because the work was already
        // stored, and POST /sync/push answers 200 while refusing items inside
        // it. Claiming "lost" would be a fabricated fact (P4) that reads as a
        // farmer losing a day.
        props["workKept"] = rejectedWorkItems > 0 ? Lost : Unknown;

        // Authored text only. Null when the code is not catalogued, which is
        // the honest answer — AdminFarmerHealthRepository.cs:368 already reads
        // props->>'message' with a COALESCE to '', so a null simply leaves that
        // field as blank as it is today.
        props["message"] = ErrorExplanations.For(errorCode)?.Meaning;

        props["appVersion"] = SanitiseAppVersion(ctx.Request.Headers["X-App-Version"].FirstOrDefault());

        return props;
    }
}
```

> **Where `SanitiseAppVersion` goes.** It is a SIBLING method of `Build`, not nested inside it —
> C# has no local methods carrying `private static`, and pasting it into the body fails with
> CS1513 / CS1519 / CS1022 before anything runs. Add it after `Build` closes:
>
> ```csharp
>     // A client can send anything in this header, and analytics.events is
>     // append-only — whatever lands there cannot be edited out later. Cap the
>     // length and allow only version-shaped characters. Anything else is
>     // recorded as "malformed" rather than dropped, so a client sending junk
>     // stays visible instead of silently becoming null.
>     private static string? SanitiseAppVersion(string? raw)
>     {
>         if (string.IsNullOrWhiteSpace(raw)) return null;
>         if (raw.Length > 32) return "malformed";
>         foreach (var c in raw)
>         {
>             if (!char.IsAsciiLetterOrDigit(c) && c != '.' && c != '-' && c != '+') return "malformed";
>         }
>         return raw;
>     }
> ```
>
> Verified on net10.0: `char.IsAsciiLetterOrDigit` exists; `1.0.9` and `1.0.9-beta+17` pass,
> markup / Devanagari / 33-character input all return `"malformed"`, blank returns `null`.

- [x] **Step 3b: Guard the version filter — it is the only thing standing between a client and a permanent record**

Add to `RequestObservabilityPropsTests.cs`. `analytics.events` is append-only: whatever a client
puts in `appVersion` can never be edited or scrubbed out. The filter works today, but without a test
a future change that quietly widens it would leave no trace and nothing would go red.

```csharp
    [Theory]
    [InlineData("1.0.9", "1.0.9")]
    [InlineData("1.0.9-beta+17", "1.0.9-beta+17")]
    [InlineData("<script>x</script>", "malformed")]
    [InlineData("मराठी", "malformed")]          // Devanagari
    [InlineData("1.0.9 extra", "malformed")]                                  // embedded space
    [InlineData("123456789012345678901234567890123", "malformed")]            // 33 chars, over the cap
    public void An_app_version_is_recorded_only_if_it_looks_like_a_version(string sent, string expected)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "POST";
        ctx.Request.Path = "/sync/push";
        ctx.Request.Headers["X-App-Version"] = sent;
        ctx.Response.StatusCode = 500;

        var props = RequestObservabilityProps.Build(ctx, latencyMs: 1, rejectedWorkItems: 0);

        Assert.Equal(expected, props["appVersion"]);
    }

    [Fact]
    public void A_missing_app_version_is_null_and_never_the_word_malformed()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "POST";
        ctx.Request.Path = "/sync/push";
        ctx.Response.StatusCode = 500;

        var props = RequestObservabilityProps.Build(ctx, latencyMs: 1, rejectedWorkItems: 0);

        // Absent and malformed are different facts. A client that sent nothing has
        // not misbehaved, and recording it as malformed would be a fabricated claim
        // about that client — the same rule as unmeasured never being rendered as 0.
        Assert.Null(props["appVersion"]);
    }
```

Run: `dotnet test src/tests/AgriSync.BuildingBlocks.Tests/ --filter "FullyQualifiedName~An_app_version"`
Expected: PASS, 7 cases.

- [x] **Step 4: Run the tests**

Run: `dotnet test src/tests/AgriSync.BuildingBlocks.Tests/ --filter "FullyQualifiedName~RequestObservabilityProps"`
Expected: PASS, all 8 facts.

- [x] **Step 5: Commit**

```bash
git add src/AgriSync.BuildingBlocks/Analytics/RequestObservabilityProps.cs \
        src/tests/AgriSync.BuildingBlocks.Tests/Analytics/RequestObservabilityPropsTests.cs
git commit -m "feat(observability): build the api.error props bag testably

spec: error-capture-engine

workKept is stated, never inferred. 'lost' only when the endpoint counted
refused work — several 409s fire because the work WAS stored, so a status
code is not evidence of loss either way. statusCode keeps its name: three
live SQL readers depend on it and Postgres answers an absent key with NULL."
```

---

### Task 5: Make the middleware see the failures it currently misses

**Files:**
- Modify: `src/AgriSync.Bootstrapper/Middleware/RequestObservabilityMiddleware.cs`
- Create: `src/tests/AgriSync.ArchitectureTests/RequestObservabilityMiddlewareTests.cs`

**Interfaces:**
- Consumes: `RequestObservabilityProps.Build` (Task 4); `RequestObservabilityKeys.ErrorCode` (Task 1).
- Produces: the serialized `PropsJson` on every emitted row. Task 7 asserts the vocabulary accepts it.

**Gap G1, restated against the repo — it is worse than "recorded as Uncatalogued".** An unhandled exception is **not recorded at all** today. `InvokeAsync` (lines 56-60) is:

```csharp
    public async Task InvokeAsync(HttpContext ctx)
    {
        var sw = Stopwatch.StartNew();
        await next(ctx);
        sw.Stop();
```

There is no `try` anywhere in the method. Everything from the status read (line 62) to the emit (line 155) sits after the `await`. And `Program.cs:542` registers `app.UseExceptionHandler()` 39 lines **before** `Program.cs:581` registers this middleware, so the handler is further **out** in the pipeline: an exception thrown by an endpoint unwinds straight past every one of those lines and is caught upstream by `GlobalExceptionHandler`, which writes the 500. So for the whole null-reference / timeout / `DbUpdateException` class of 500 there is no row to look at — before this plan or after it, unless this task lands.

`GlobalExceptionHandler` is the wrong place to fix it: by the time it runs, this middleware has already unwound and will never resume. The fix has to be here, and it works because this middleware sits **inside** the handler, so the exception passes through it first.

- [x] **Step 1: Write the failing test**

Create `src/tests/AgriSync.ArchitectureTests/RequestObservabilityMiddlewareTests.cs`:

```csharp
using System.Text.Json;
using AgriSync.Bootstrapper.Middleware;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Proves the WIRING, not just the parts. Task 1 stamps, Task 4 builds; this
/// asserts that a stamped result executed through the real middleware produces
/// a row that names the error — and that an exception escaping the endpoint
/// produces a row at all, which it does not today.
/// </summary>
public sealed class RequestObservabilityMiddlewareTests
{
    private sealed class CapturingWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();

        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            lock (Events) { Events.Add(e); }
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> es, CancellationToken ct = default)
        {
            lock (Events) { Events.AddRange(es); }
            return Task.CompletedTask;
        }
    }

    private static (RequestObservabilityMiddleware Mw, CapturingWriter Writer) Build(RequestDelegate next)
    {
        var writer = new CapturingWriter();
        var services = new ServiceCollection();
        services.AddScoped<IAnalyticsWriter>(_ => writer);
        var provider = services.BuildServiceProvider();

        var mw = new RequestObservabilityMiddleware(
            next,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RequestObservabilityMiddleware>.Instance);

        return (mw, writer);
    }

    /// <summary>
    /// The emit is fire-and-forget (Task.Run) by design — observability must
    /// never hold up a farmer's request — so poll rather than sleep a fixed time.
    /// </summary>
    private static async Task<AnalyticsEvent?> WaitForEvent(CapturingWriter w)
    {
        for (var i = 0; i < 200; i++)
        {
            lock (w.Events) { if (w.Events.Count > 0) return w.Events[0]; }
            await Task.Delay(25);
        }
        return null;
    }

    private static DefaultHttpContext WriteContext() => new()
    {
        Response = { Body = new MemoryStream() },
        RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        Request = { Method = "POST", Path = "/shramsafal/logs" },
    };

    [Fact]
    public async Task A_stamped_error_result_produces_a_row_that_names_the_error()
    {
        var error = ShramSafal.Domain.Common.ShramSafalErrors.CropCycleOverlap;

        var (mw, writer) = Build(async ctx =>
            await ErrorCapture.Stamp(error, Results.Conflict(new { error = error.Code }))
                .ExecuteAsync(ctx));

        await mw.InvokeAsync(WriteContext());

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull();
        ev!.EventType.Should().Be(AnalyticsEventType.ApiError);

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("ShramSafal.CropCycleOverlap",
            "the endpoint knew which error it was answering; the record has to know too");
        props["statusCode"].GetInt32().Should().Be(409);
        props["workKept"].GetString().Should().Be("unknown");
    }

    [Fact]
    public async Task An_exception_escaping_the_endpoint_produces_a_row_naming_its_type()
    {
        // Before 2026-08-30 this produced NOTHING: InvokeAsync had no try, and
        // UseExceptionHandler is registered outside this middleware
        // (Program.cs:542 vs :581), so the exception unwound past every line
        // that builds and emits the event.
        var (mw, writer) = Build(_ => throw new InvalidOperationException("boom"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => mw.InvokeAsync(WriteContext()));

        var ev = await WaitForEvent(writer);
        ev.Should().NotBeNull("an unhandled exception is the failure a developer most needs recorded");

        var props = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ev!.PropsJson!)!;
        props["errorCode"].GetString().Should().Be("Exception:InvalidOperationException");
        props["statusCode"].GetInt32().Should().Be(500,
            "the response had not been written when the exception passed through, so the "
            + "status is asserted from the exception rather than read from ctx.Response");
        props.Should().NotContainKey("exceptionMessage",
            "analytics.events is append-only and an exception message can carry the payload");
    }

    [Fact]
    public async Task A_cancelled_request_is_not_reported_as_a_server_failure()
    {
        // A farmer on Jio closing the tab is not a 500. GlobalExceptionHandler
        // makes the same distinction (returns false for a cancelled request).
        var (mw, writer) = Build(_ => throw new OperationCanceledException());

        var ctx = WriteContext();
        ctx.RequestAborted = new CancellationToken(canceled: true);

        await Assert.ThrowsAsync<OperationCanceledException>(() => mw.InvokeAsync(ctx));

        await Task.Delay(300);
        lock (writer.Events) { writer.Events.Should().BeEmpty(); }
    }
}
```

- [x] **Step 2: Run and confirm it fails**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~RequestObservabilityMiddlewareTests"`
Expected: FAIL — the first test fails on a missing `errorCode` key; the second fails because no event is ever emitted.

- [x] **Step 3: Rewrite `InvokeAsync` so the emit runs on the exception path**

Replace `RequestObservabilityMiddleware.InvokeAsync` (lines 56-156) with the following. Everything from the old line 62 onward moves into `Observe`, unchanged except where marked. `TryExtractFarmId`, `TryExtractRejectedWorkItems` and `CriticalPathFragments` are untouched.

```csharp
    public async Task InvokeAsync(HttpContext ctx)
    {
        var sw = Stopwatch.StartNew();
        Exception? unhandled = null;

        try
        {
            await next(ctx);
        }
        catch (Exception ex)
        {
            // Before 2026-08-30 there was no try here, and UseExceptionHandler
            // is registered OUTSIDE this middleware (Program.cs:542 vs :581),
            // so an escaping exception unwound straight past every line below
            // and the single most useful class of 500 — null reference,
            // timeout, DbUpdateException — produced no row at all.
            unhandled = ex;
            throw;
        }
        finally
        {
            sw.Stop();
            // Must never throw: this runs while an exception may be
            // propagating, and a throw from a finally would REPLACE the real
            // failure with an observability bug.
            try
            {
                Observe(ctx, (int)sw.ElapsedMilliseconds, unhandled);
            }
            catch (Exception observeEx)
            {
                logger.LogWarning(
                    observeEx,
                    "RequestObservabilityBuildFailed: endpoint={Endpoint}. No analytics row "
                    + "for this request; the request itself is unaffected.",
                    LogSafe.Text($"{ctx.Request.Method} {ctx.Request.Path}"));
            }
        }
    }

    private void Observe(HttpContext ctx, int ms, Exception? unhandled)
    {
        // A farmer closing the tab mid-request is not a server failure.
        // GlobalExceptionHandler makes the same call (returns false for a
        // cancelled request rather than writing a 500).
        if (unhandled is OperationCanceledException && ctx.RequestAborted.IsCancellationRequested)
        {
            return;
        }

        var method = ctx.Request.Method;
        var path = ctx.Request.Path.Value ?? string.Empty;
        var isWrite = method is "POST" or "PUT" or "PATCH" or "DELETE";

        // On the exception path the response has NOT been written yet — the
        // handler upstream writes the 500 after we unwind — so ctx.Response
        // still reads 200. Assert the status from the exception rather than
        // reading a value that has not happened.
        var status = unhandled is not null
            ? StatusCodes.Status500InternalServerError
            : ctx.Response.StatusCode;

        var isError = status >= 500;
        var isCritical4xx = status is >= 400 and < 500
                         && isWrite
                         && CriticalPathFragments.Any(f =>
                                path.Contains(f, StringComparison.OrdinalIgnoreCase));
        var isSlow = isWrite && ms > 2000 && status < 400;

        // RG5 — the status code says success, the endpoint says otherwise.
        var rejectedWorkItems = TryExtractRejectedWorkItems(ctx);
        var hasRejectedWork = rejectedWorkItems > 0;

        if (!isError && !isCritical4xx && !isSlow && !hasRejectedWork) return;

        // A refused work item inside a 2xx is NOT an api.error. It gets its own
        // type so the existing api.error consumers keep their meaning — see the
        // comment on AnalyticsEventType.SyncMutationRejected for what breaks
        // otherwise (a false founder page from mis.alert_r9_api_error_spike).
        // A genuine 5xx still wins: if the request also failed, that is the
        // more urgent fact and it is reported as such.
        var eventType = (isError || isCritical4xx)
            ? AnalyticsEventType.ApiError
            : hasRejectedWork
                ? AnalyticsEventType.SyncMutationRejected
                : AnalyticsEventType.ApiSlow;

        var farmId = TryExtractFarmId(ctx.User);
        var traceId = Activity.Current?.TraceId.ToString()
                   ?? ctx.TraceIdentifier;

        // The whole bag comes from one place and is serialized as-is. Nothing
        // is merged in afterwards: a post-hoc merge could drop or override a
        // required prop and the parity test would never see it.
        var props = System.Text.Json.JsonSerializer.Serialize(
            RequestObservabilityProps.Build(
                ctx,
                eventType,
                status,
                ms,
                hasRejectedWork ? rejectedWorkItems : null,
                hasRejectedWork
                    ? ctx.Items[RequestObservabilityKeys.RejectedWorkReason] as string
                    : null,
                farmId,
                traceId,
                // Type name only. The MESSAGE is deliberately not captured: a
                // Postgres or serializer message can carry the request payload,
                // and analytics.events is append-only.
                unhandled?.GetType().Name));

        // Fire-and-forget in a new scope — IAnalyticsWriter is scoped
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var analytics = scope.ServiceProvider.GetRequiredService<IAnalyticsWriter>();
                await analytics.EmitAsync(new AnalyticsEvent(
                    EventId: Guid.NewGuid(),
                    EventType: eventType,
                    OccurredAtUtc: DateTime.UtcNow,
                    ActorUserId: null,
                    FarmId: farmId.HasValue ? new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId.Value) : null,
                    OwnerAccountId: null,
                    ActorRole: "system",
                    Trigger: "middleware",
                    DeviceOccurredAtUtc: null,
                    SchemaVersion: "v1",
                    PropsJson: props));
            }
            catch (Exception ex)
            {
                // Do not rethrow — observability must never crash the app — but
                // do not hide it either. Warning is the production Serilog
                // minimum level, so this lands in /var/log/agrisync/api-*.log
                // on the box. That is the named landing place for a failed
                // emit; LogDebug (the previous level) was below the production
                // threshold and therefore went nowhere.
                logger.LogWarning(
                    ex,
                    "RequestObservabilityEmitFailed: eventType={EventType} endpoint={Endpoint} "
                    + "statusCode={StatusCode} exceptionType={ExceptionType}. "
                    + "This analytics row is lost; the metric/log signals at the emit site are not.",
                    eventType,
                    // The path comes off the request line, so it is
                    // attacker-controlled — CWE-117, CodeQL on PR #56. The
                    // method is matched by the router and eventType is one of
                    // our own constants; neither needs wrapping.
                    LogSafe.Text($"{method} {path}"),
                    status,
                    ex.GetType().Name);
            }
        });
    }
```

- [x] **Step 4: Run the middleware tests and the full suite**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~RequestObservabilityMiddlewareTests"`
Expected: PASS, all 3 facts.

Run: `dotnet test src/AgriSync.sln --filter "Category!=RequiresDocker"`
Expected: PASS. Watch anything asserting on `api.error` props — `AdminFarmerHealthRepository` and `mis.alert_r9_api_error_spike` read this event and must be unaffected by additive keys.

- [x] **Step 5: Commit**

```bash
git add src/AgriSync.Bootstrapper/Middleware/RequestObservabilityMiddleware.cs \
        src/tests/AgriSync.ArchitectureTests/RequestObservabilityMiddlewareTests.cs
git commit -m "fix(observability): record unhandled exceptions, which produced none

spec: error-capture-engine

InvokeAsync had no try, and UseExceptionHandler is registered outside this
middleware, so a null reference or a timeout unwound past every line that
builds and emits the event. The single most useful class of 500 was invisible.
The emit now runs from a finally; the exception TYPE is recorded, never its
message — analytics.events is append-only and a message can carry the payload."
```

---

### Task 6: Widen the vocabulary and amend the ADR

**Files:**
- Modify: `src/apps/Analytics/Analytics.Domain/Vocabulary/EventVocabulary.cs:72-76`
- Modify: `src/tests/Analytics.UnitTests/EventVocabularyTests.cs:199-215`
- Modify: `_COFOUNDER/Projects/AgriSync/Architecture/ADRs/ADR-2026-05-02_event-vocabulary.md` (separate nested repo, separate commit)

**Interfaces:**
- Consumes: nothing at compile time.
- Produces: the `api.error` contract — `RequiredProps: ["endpoint", "statusCode", "errorCode", "workKept"]`. Task 5 already satisfies it; Task 7 asserts that it does.

**Ordering note.** This task deliberately lands **after** Task 5. The reverse order would leave `main` carrying a declared contract that no producer satisfies, with the only test proving agreement (Task 7) not yet written. Every commit in this plan must leave `main` green and self-consistent.

**`statusCode`, not `status`.** `EventVocabulary.cs:76` lists `status` as optional; the emitter has always written `statusCode` (`RequestObservabilityMiddleware.cs:100`) and a search for `props->>'status'` across `src/` returns zero hits. The documented name was aspirational fiction; the SQL follows the emitter. Making the fiction *required* would have forced Task 5 to emit it and silently broken three live readers. The doc is corrected to match reality.

- [x] **Step 1: Write the failing test**

Add to `src/tests/Analytics.UnitTests/EventVocabularyTests.cs` (FluentAssertions — that project has it):

```csharp
    [Fact]
    public void ApiError_requires_the_error_to_name_itself_and_state_the_work_outcome()
    {
        var def = EventVocabulary.Registry["api.error"];

        def.RequiredProps.Should().Contain("errorCode",
            "an error that cannot say which error it was is the defect this contract exists to prevent");
        def.RequiredProps.Should().Contain("workKept",
            "whether the farmer's work survived is the difference between an annoyance and a lost day");
        def.RequiredProps.Should().Contain("statusCode",
            "AdminOpsRepository.cs:99/:226 and AdminFarmerHealthRepository.cs:367 read "
            + "props->>'statusCode'; this registry said 'status' for months while the emitter "
            + "said 'statusCode'");
        def.RequiredProps.Should().NotContain("status",
            "nothing has ever emitted or read a key called 'status' — requiring it would have "
            + "broken three live queries");
        def.Optional.Should().Contain(new[] { "farmId", "message", "appVersion" });
    }
```

- [x] **Step 2: Replace the test that asserts the opposite**

`EventVocabularyTests.cs:199-215` is `Validator_Accepts_ApiError_With_Empty_Props_Bag`, which asserts that an empty `api.error` bag validates. Task 6 makes that false. It is not a casualty to be discovered on a red run — it encodes a deliberate 2026-05-02 position that is being consciously reversed. Replace it entirely:

```csharp
    [Fact]
    public void Validator_Rejects_An_ApiError_That_Cannot_Name_Itself()
    {
        // SUPERSEDES Validator_Accepts_ApiError_With_Empty_Props_Bag (2026-05-02),
        // whose rationale was: "api.error has zero RequiredProps because pre-auth
        // failures fire before farmId is known. Rejecting would force pre-auth
        // code to invent placeholder values, defeating the point."
        //
        // That argument survives for farmId — which is exactly why farmId stays
        // OPTIONAL. It does not extend to the other four. A pre-auth failure
        // still knows its endpoint, its status code, and whether it refused any
        // work; and if no catalogued Error produced it, it says so with the
        // literal "Uncatalogued". Nothing is forced to invent anything.
        //
        // Reversed by founder decision 2026-08-30, spec
        // 2026-08-30-error-capture-scope D1. ADR-2026-05-02 amended to match.
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("api.error", new Dictionary<string, object?>()),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
        result.Errors[0].Code.Should().Be("analytics.missing_required_prop");
        result.Errors[0].MissingProps.Should().BeEquivalentTo(
            new[] { "endpoint", "statusCode", "errorCode", "workKept" });
    }
```

- [x] **Step 3: Run and confirm both fail**

Run: `dotnet test src/tests/Analytics.UnitTests/`
Expected: FAIL — `ApiError_requires...` fails (`RequiredProps` is empty today) and `Validator_Rejects_An_ApiError_That_Cannot_Name_Itself` fails (the empty bag is still accepted). Everything else passes: `Registry_Has_Exactly_13_Entries`, `Registry_Contains_All_ADR_Event_Names` and `Every_Vocabulary_Event_RoundTrips_With_Its_Required_Props` all survive, because this task changes one entry's contents and not the key set, and the round-trip theory synthesises a value for every required prop.

- [x] **Step 4: Widen the entry**

Replace `EventVocabulary.cs:72-76`:

```csharp
            // 2026-08-30 (founder decision, spec 2026-08-30-error-capture-scope):
            // an api.error MUST name itself and MUST state whether the farmer's
            // work survived. Before this the row kept only endpoint/status/farmId
            // — so `ShramSafal.CropCycleOverlap` travelled correctly all the way
            // to the client and the record we kept said `500`.
            //
            // `workKept` is three-state: "kept" | "lost" | "unknown". Required
            // means it must be STATED, never that it must be known — claiming
            // "kept", or reading "lost" off a status code, violates P4.
            //
            // farmId stays OPTIONAL: the 2026-05-02 rationale holds for it
            // specifically, because pre-auth failures fire before the user is
            // known. It does not hold for the other four — a pre-auth failure
            // still knows its endpoint, its status and whether it refused work,
            // and names itself "Uncatalogued" when no catalogued Error produced it.
            //
            // The key is `statusCode`, NOT `status`. This entry listed `status`
            // from the day it was written and nothing ever emitted or read it;
            // the emitter has always written `statusCode`
            // (RequestObservabilityMiddleware.cs) and three live queries read
            // props->>'statusCode' (AdminOpsRepository.cs:99, :226,
            // AdminFarmerHealthRepository.cs:367). The doc was wrong, not the code.
            ["api.error"] = new(
                RequiredProps: ["endpoint", "statusCode", "errorCode", "workKept"],
                Optional: ["farmId", "message", "appVersion",
                           "latencyMs", "traceId",
                           "rejectedWorkItems", "rejectedWorkReason"]),
```

- [x] **Step 5: Run the whole Analytics suite**

Run: `dotnet test src/tests/Analytics.UnitTests/`
Expected: PASS — 13 entries, all ADR names present, round-trip green, and both new assertions green. The `event-vocabulary-parity` CI gate is unaffected: it compares event **names** only and never inspects `RequiredProps`.

- [x] **Step 6: Commit the app change**

```bash
git add src/apps/Analytics/Analytics.Domain/Vocabulary/EventVocabulary.cs \
        src/tests/Analytics.UnitTests/EventVocabularyTests.cs
git commit -m "feat(analytics): an api.error must name itself and its outcome

spec: error-capture-engine

The vocabulary permitted only endpoint/status/farmId, so it refused the
error's own identity. errorCode and workKept are now required, and the
documented key is corrected from 'status' (never emitted, never read) to
'statusCode' (what the emitter has always written and three queries read).

Reverses the 2026-05-02 position that api.error accepts an empty bag; that
rationale is preserved for farmId, which stays optional. ADR-2026-05-02
amended in the _COFOUNDER repo."
```

- [x] **Step 7: Amend the ADR — separate repo, separate commit**

`_COFOUNDER/` is a private nested git repo. Files under it commit to `_COFOUNDER/.git`, never to the parent. Never mix the two in one commit.

In `_COFOUNDER/Projects/AgriSync/Architecture/ADRs/ADR-2026-05-02_event-vocabulary.md`, replace line 31:

    | `api.error` | EXISTING | (no change) | (no change) |

with:

    | `api.error` | AMENDED 2026-08-30 | `endpoint`, `statusCode`, `errorCode`, `workKept` | `farmId`, `message`, `appVersion`, `latencyMs`, `traceId`, `rejectedWorkItems`, `rejectedWorkReason` |

and immediately after the existing line 41 (`- api.error retains farmId as optional only because…`) add:

    - **Amendment, 2026-08-30 (founder decision; spec `2026-08-30-error-capture-scope`).** `api.error` no longer has zero required props. It must carry `endpoint`, `statusCode`, `errorCode` and `workKept`. The original rationale — that a pre-auth failure cannot invent a `farmId` — is preserved exactly: `farmId` stays optional. It does not extend to the other four, because a pre-auth failure still knows its endpoint, its status and whether it refused work, and names itself `Uncatalogued` when no catalogued `Error` produced it. `workKept` is three-state (`kept`/`lost`/`unknown`) and must be stated, never guessed; `lost` is recorded only when refused work was counted. The documented key is `statusCode`, not `status` — this ADR said `status` and nothing has ever emitted or read it.

```bash
cd _COFOUNDER
git add Projects/AgriSync/Architecture/ADRs/ADR-2026-05-02_event-vocabulary.md
git commit -m "docs(adr): amend ADR-2026-05-02 — api.error required props

EventVocabulary.cs names this ADR as its source of truth and states that its
layout matches this table row-for-row. Widening the contract in code without
amending here would have left the two silently drifted."
cd ..
```

---

### Task 7: The parity gate — the vocabulary judges the middleware

**Files:**
- Create: `src/tests/AgriSync.ArchitectureTests/ApiErrorContractParityTests.cs`

**Interfaces:**
- Consumes: `EventVocabulary.Registry["api.error"]` (Task 6); `IngestEventsValidator` (`Analytics.Application`); `RequestObservabilityProps.Build` (Task 4).
- Produces: nothing consumed downstream. This is a gate.

**Why this task exists.** `IngestEventsValidator` enforces `RequiredProps` only for events arriving at `POST /analytics/events`. `api.error` is a **server-only** event — `check-event-vocabulary-parity.mjs` lists it in `SERVER_ONLY`, and `eventSchema.ts` confirms it lives exclusively on the backend — and the middleware writes it directly through `IAnalyticsWriter`, which has no validation hook. Without this test, "required" is enforced on a code path that never carries an `api.error`.

**Why it is placed in `AgriSync.ArchitectureTests` and not `Analytics.UnitTests`.** `Analytics.UnitTests.csproj` references only `Analytics.Domain` and `Analytics.Application` — it cannot see `RequestObservabilityProps` (BuildingBlocks) and has no ASP.NET Core framework reference, so the test would not compile there. `AgriSync.ArchitectureTests` references `AgriSync.BuildingBlocks` directly and `Analytics.Domain` + `Analytics.Application` transitively through `AgriSync.Bootstrapper`, and already carries FluentAssertions.

**Why it runs the real validator instead of a `foreach` over key names.** A loop asserting `ContainsKey` on the four required names would be unfalsifiable — `Build` writes all four unconditionally, three of them as literals. Handing the built bag to `IngestEventsValidator` makes the **vocabulary** the judge, and the second fact below proves the gate can actually fail.

- [x] **Step 1: Write the test**

```csharp
using AgriSync.BuildingBlocks.Analytics;
using Analytics.Application.UseCases.IngestEvents;
using Analytics.Domain.Vocabulary;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// api.error is server-only: the middleware writes it through IAnalyticsWriter
/// and never passes IngestEventsValidator, so "required" would otherwise be
/// enforced for client-submitted events and silently optional for our own —
/// exactly the class of gap this plan closes.
///
/// The vocabulary is the judge here, not a list of key names copied into the
/// test. If EventVocabulary and RequestObservabilityProps ever disagree, this
/// goes red rather than one of them quietly winning.
/// </summary>
public sealed class ApiErrorContractParityTests
{
    private static Dictionary<string, object?> BuiltApiErrorProps(
        string? stampedCode, int status, int? rejected)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "POST";
        ctx.Request.Path = "/shramsafal/logs";
        ctx.Response.StatusCode = status;
        if (stampedCode is not null)
        {
            ctx.Items[RequestObservabilityKeys.ErrorCode] = stampedCode;
        }

        return RequestObservabilityProps.Build(
            ctx,
            eventType: AnalyticsEventType.ApiError,
            status: status,
            latencyMs: 7,
            rejectedWorkItems: rejected,
            rejectedWorkReason: rejected > 0 ? "sync.mutation_rejected" : null,
            farmId: null,
            traceId: "trace-1",
            unhandledExceptionType: null);
    }

    [Theory]
    // A catalogued failure.
    [InlineData("ShramSafal.CropCycleOverlap", 409, null)]
    // A failure with no catalogued Error — still has to name itself, honestly.
    [InlineData(null, 500, null)]
    // A 200 that refused work inside it (RG5).
    [InlineData("ShramSafal.LabourAssignment.Conflict", 200, 3)]
    public void The_middleware_payload_satisfies_the_vocabulary(
        string? stampedCode, int status, int? rejected)
    {
        var props = BuiltApiErrorProps(stampedCode, status, rejected);

        var outcome = new IngestEventsValidator().Validate(
            new IngestEventsCommand(new[] { new IngestedEvent("api.error", props) }));

        outcome.IsValid.Should().BeTrue(
            "the middleware bypasses IngestEventsValidator at runtime, so this test is the "
            + "only thing holding the api.error contract on the path that actually produces "
            + "them. Missing: "
            + string.Join(", ", outcome.Errors.SelectMany(e => e.MissingProps ?? [])));
    }

    [Fact]
    public void The_gate_can_actually_fail()
    {
        // A test that cannot fail is not a gate. Drop each required prop in turn
        // and prove the validator rejects — otherwise the theory above is
        // asserting nothing.
        var required = EventVocabulary.Registry["api.error"].RequiredProps;
        required.Should().NotBeEmpty();

        foreach (var key in required)
        {
            var mutilated = BuiltApiErrorProps("ShramSafal.CropCycleOverlap", 409, null);
            mutilated.Remove(key);

            var outcome = new IngestEventsValidator().Validate(
                new IngestEventsCommand(new[] { new IngestedEvent("api.error", mutilated) }));

            outcome.IsValid.Should().BeFalse($"'{key}' is required, so removing it must be rejected");
            outcome.Errors[0].MissingProps.Should().Contain(key);
        }
    }

    [Fact]
    public void Every_required_prop_is_supplied_with_a_non_null_value()
    {
        // IngestEventsValidator treats a null VALUE as missing
        // (IngestEventsValidator.cs:82), so presence alone is not enough.
        var props = BuiltApiErrorProps(null, 500, null);

        foreach (var key in EventVocabulary.Registry["api.error"].RequiredProps)
        {
            props.Should().ContainKey(key);
            props[key].Should().NotBeNull($"'{key}' is required and a null value counts as missing");
        }
    }
}
```

- [x] **Step 2: Run it**

Run: `dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ApiErrorContractParity"`
Expected: PASS — Tasks 4, 5 and 6 were written to agree. If it fails, one of them is wrong; fix that rather than weakening this test.

- [x] **Step 3: Commit**

```bash
git add src/tests/AgriSync.ArchitectureTests/ApiErrorContractParityTests.cs
git commit -m "test(analytics): hold the api.error contract on the middleware path

spec: error-capture-engine

api.error is server-only and the middleware writes through IAnalyticsWriter,
which has no validation hook — so nothing enforced required props on the one
path that actually produces them. The vocabulary judges the real built payload,
and a negative case proves the gate can fail."
```

---

### Task 8: Carry it to the admin API

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/AdminOpsHealthDto.cs` (the `OpsErrorEventDto` record)
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/AdminOpsRepository.cs` — **both** `GetRecentErrorsAsync` (lines 85-123) and `GetErrorsPagedAsync` (lines 196-255)
- Create: `src/tests/ShramSafal.Admin.IntegrationTests/AdminOpsErrorProjectionTests.cs`

**Interfaces:**
- Consumes: the widened props (Task 5); `ErrorExplanations.For` (Task 3). `ShramSafal.Infrastructure` already references `AgriSync.BuildingBlocks`, so the call is layer-legal.
- Produces: `OpsErrorEventDto` gaining `string? ErrorCode`, `string? WorkKept`, `string? Message`, `string? AppVersion`, `string? Meaning`, `string? UsualCause`. `IAdminOpsRepository` is **not** changed — no signature moves.

**The record is constructed in TWO places, both positional.** Widening it is a compile error in both. `GetRecentErrorsAsync` (line 112) backs `AdminOpsHealthDto.RecentErrors` on `/admin/ops/health`; `GetErrorsPagedAsync` (line 244) backs `/admin/ops/errors`. Both get the same treatment so the two admin surfaces cannot disagree about what a failure was.

The real signature is `Task<OpsErrorsPageDto> GetErrorsPagedAsync(int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default)` — five parameters. There is no method named `GetOpsErrorsAsync` anywhere in the repo.

**The new members are nullable.** Historical rows written before this deploy have no `errorCode`, and `props->>'errorCode'` on an absent key is SQL `NULL`. A non-nullable `string ErrorCode` would force a fabricated default onto every row already in the table, and `analytics.events` is append-only — there is no backfill.

**Both methods swallow everything.** `AdminOpsRepository.cs:121` is a bare `catch { }` and `:253` is `catch { return new OpsErrorsPageDto([], 0, page, pageSize); }`. A mistake in the new projection would therefore present as an empty admin screen and never as an error, and the test below would fail with a confusing "no matching row". Step 4c narrows them. `DependencyRuleTests.Application_layer_must_not_silently_swallow_exceptions` scans `*.Application.csproj` only, so Infrastructure sits outside it today — this is a voluntary fix at the one place this plan adds new SQL.

- [x] **Step 1: Write the failing test**

Create `src/tests/ShramSafal.Admin.IntegrationTests/AdminOpsErrorProjectionTests.cs`. This is the **first** coverage `AdminOpsRepository` has ever had. It uses `AdminTestFixture`, which stands up a real local Postgres (port 5433, Docker-free) and calls `AnalyticsDbContext.Database.EnsureCreatedAsync()`, so `analytics.events` exists. CI sets `ADMIN_TESTS_ADMIN_ROOT_CONN` (`ci-gate.yml:38`) and runs this project under the standard `Category!=RequiresDocker` gate, so this test **does** run in the gate.

**Partition caveat, so the executor is not surprised.** In production `analytics.events` is `PARTITION BY RANGE (occurred_at_utc)` with monthly partitions created by the migration (`20260419054331_AnalyticsInitial.cs:36-49`). `AdminTestFixture` builds this context with `EnsureCreatedAsync()`, which materialises the EF model — a plain, unpartitioned table — so `INSERT ... NOW()` needs no partition. If this test is ever moved to a fixture that runs the real Analytics migrations, confirm a partition covering the current month exists first; otherwise the insert fails with "no partition of relation found", which reads like a permissions problem and is not one. The columns used below are the real ones: `event_id`, `event_type`, `occurred_at_utc`, `actor_role`, `trigger` are `NOT NULL`; `schema_version` and `props` carry defaults and are supplied anyway.

```csharp
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using AgriSync.BuildingBlocks.Analytics;   // AnalyticsDbContext lives here — omitting this is CS0246
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// First coverage for AdminOpsRepository. Both error-listing methods project
/// out of analytics.events' JSON props, and both swallowed every exception, so
/// until now a wrong projection would have shown an empty admin console and
/// nothing anywhere would have said why.
/// </summary>
[Collection(nameof(AdminTestCollection))]
public sealed class AdminOpsErrorProjectionTests(AdminTestFixture fixture)
{
    private async Task SeedApiErrorAsync(string propsJson, Guid? farmId = null)
    {
        await using var scope = fixture.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();
        var conn = (NpgsqlConnection)ctx.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_role, trigger,
                 schema_version, farm_id, props)
            VALUES
                (@id, 'api.error', NOW(), 'system', 'middleware',
                 'v1', @farm, @props::jsonb)
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", (object?)farmId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("props", propsJson);
        await cmd.ExecuteNonQueryAsync();
    }

    private static AdminOpsRepository Repository(IServiceScope scope)
        => new(scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>(),
               scope.ServiceProvider.GetRequiredService<ILogger<AdminOpsRepository>>());

    [Fact]
    public async Task Ops_errors_carry_the_error_code_and_its_explanation()
    {
        await SeedApiErrorAsync("""
            {"endpoint":"POST /shramsafal/logs","statusCode":409,"latencyMs":42,
             "errorCode":"ShramSafal.CropCycleOverlap","workKept":"unknown",
             "message":"Two crop cycles claim the same plot over the same dates.",
             "appVersion":"1.0.9"}
            """);

        await using var scope = fixture.Services.CreateAsyncScope();
        var page = await Repository(scope).GetErrorsPagedAsync(
            page: 1, pageSize: 20, endpoint: null, since: null, ct: CancellationToken.None);

        var row = page.Items.Single(r => r.ErrorCode == "ShramSafal.CropCycleOverlap");

        row.StatusCode.Should().Be(409,
            "props->>'statusCode' is the key three live queries read; a rename would null this silently");
        row.WorkKept.Should().BeOneOf("kept", "lost", "unknown");
        row.AppVersion.Should().Be("1.0.9");
        row.Meaning.Should().NotBeNullOrWhiteSpace(
            "the console must never show a bare code that the reader has to look up elsewhere");
        row.UsualCause.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task A_row_written_before_this_deploy_reads_back_without_inventing_anything()
    {
        // The old props shape. errorCode is absent, so it must come back null —
        // not "Uncatalogued", not "", not a guess. analytics.events is
        // append-only; there is no backfill and there must be no fabrication.
        await SeedApiErrorAsync("""
            {"endpoint":"GET /shramsafal/legacy-probe","statusCode":500,"latencyMs":11,
             "traceId":"legacy"}
            """);

        await using var scope = fixture.Services.CreateAsyncScope();
        var page = await Repository(scope).GetErrorsPagedAsync(
            1, 20, "legacy-probe", null, CancellationToken.None);

        var row = page.Items.Single();
        row.ErrorCode.Should().BeNull();
        row.WorkKept.Should().BeNull();
        row.Meaning.Should().BeNull();
        row.StatusCode.Should().Be(500);
    }

    [Fact]
    public async Task The_health_snapshot_projects_the_same_fields_as_the_paged_list()
    {
        // Two separate SQL projections build the same record. Drifting apart is
        // exactly the kind of thing nobody notices until an admin reads two
        // screens and gets two answers.
        await SeedApiErrorAsync("""
            {"endpoint":"POST /shramsafal/sync/push","statusCode":200,"latencyMs":900,
             "errorCode":"ShramSafal.LabourAssignment.Conflict","workKept":"lost",
             "message":"This labour entry is already recorded on another daily log.",
             "appVersion":"1.0.9","rejectedWorkItems":3}
            """);

        await using var scope = fixture.Services.CreateAsyncScope();
        var health = await Repository(scope).GetOpsHealthAsync(CancellationToken.None);

        var row = health.RecentErrors.Single(r => r.ErrorCode == "ShramSafal.LabourAssignment.Conflict");
        row.WorkKept.Should().Be("lost");
        row.Meaning.Should().NotBeNullOrWhiteSpace();
        row.AppVersion.Should().Be("1.0.9");
    }
}
```

- [x] **Step 2: Run and confirm it fails**

Run: `dotnet test src/tests/ShramSafal.Admin.IntegrationTests/ --filter "FullyQualifiedName~AdminOpsErrorProjection"`
Expected: FAIL — compile error: `ErrorCode` is not a member of `OpsErrorEventDto`, and `AdminOpsRepository` has no two-argument constructor yet.

- [x] **Step 3: Widen the DTO**

Replace `AdminOpsHealthDto.cs:30-36`:

```csharp
public sealed record OpsErrorEventDto(
    string EventType,
    string Endpoint,
    int? StatusCode,
    int? LatencyMs,
    Guid? FarmId,
    DateTime OccurredAtUtc,
    // 2026-08-30 — the identity of the failure, not just its status code.
    // All nullable: rows written before this deploy have none of these keys,
    // and props->>'errorCode' on an absent key is SQL NULL. A non-nullable
    // member would force a fabricated default onto every historical row, and
    // analytics.events is append-only so there is no backfill.
    string? ErrorCode,
    string? WorkKept,
    string? Message,
    string? AppVersion,
    // Resolved from ErrorExplanations at READ time, not stored — so improved
    // wording reaches old rows too. `Message` is what we said at the time;
    // `Meaning` / `UsualCause` are what we say now.
    string? Meaning,
    string? UsualCause);
```

- [x] **Step 4a: Add the shared row reader**

In `AdminOpsRepository.cs`, add the usings:

```csharp
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
```

and add this private helper to the class — it keeps the two construction sites identical, which is the point:

```csharp
    /// <summary>
    /// Builds the DTO from a reader positioned on a row of either error
    /// projection. Shared so /admin/ops/health and /admin/ops/errors cannot
    /// drift into giving an admin two different answers about one failure.
    /// Column order must match both SELECTs.
    /// </summary>
    private static OpsErrorEventDto ReadErrorRow(System.Data.Common.DbDataReader r)
    {
        var errorCode = r.IsDBNull(6) ? null : r.GetString(6);
        var explanation = ErrorExplanations.For(errorCode);

        return new OpsErrorEventDto(
            EventType: r.GetString(0),
            Endpoint: r.GetString(1),
            StatusCode: r.IsDBNull(2) ? null : r.GetInt32(2),
            LatencyMs: r.IsDBNull(3) ? null : r.GetInt32(3),
            FarmId: r.IsDBNull(4) ? null : r.GetGuid(4),
            OccurredAtUtc: r.GetDateTime(5),
            ErrorCode: errorCode,
            WorkKept: r.IsDBNull(7) ? null : r.GetString(7),
            Message: r.IsDBNull(8) ? null : r.GetString(8),
            AppVersion: r.IsDBNull(9) ? null : r.GetString(9),
            Meaning: explanation?.Meaning,
            UsualCause: explanation?.UsualCause);
    }
```

- [x] **Step 4b: Extend the `/admin/ops/health` projection**

In `GetRecentErrorsAsync`, replace the `cmd.CommandText` at lines 95-108 and the reader loop at lines 110-119 with:

```csharp
            cmd.CommandText = """
                SELECT
                    event_type,
                    COALESCE(props->>'endpoint', 'unknown')  AS endpoint,
                    (props->>'statusCode')::int              AS status_code,
                    (props->>'latencyMs')::int               AS latency_ms,
                    farm_id,
                    occurred_at_utc,
                    props->>'errorCode'                      AS error_code,
                    props->>'workKept'                       AS work_kept,
                    props->>'message'                        AS message,
                    props->>'appVersion'                     AS app_version
                FROM analytics.events
                WHERE event_type IN ('api.error', 'api.slow', 'client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '2 hours'
                ORDER BY occurred_at_utc DESC
                LIMIT 50
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                results.Add(ReadErrorRow(r));
            }
```

The four new columns are **unwrapped** — no `COALESCE`. An absent key must read back as `null`, not as an invented empty string.

- [x] **Step 4c: Extend the `/admin/ops/errors` projection**

In `GetErrorsPagedAsync`, replace `dataCmd.CommandText` at lines 222-236 and the reader loop at lines 242-249 with:

```csharp
            using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText = $"""
                SELECT
                    event_type,
                    COALESCE(props->>'endpoint', 'unknown'),
                    (props->>'statusCode')::int,
                    (props->>'latencyMs')::int,
                    farm_id,
                    occurred_at_utc,
                    props->>'errorCode',
                    props->>'workKept',
                    props->>'message',
                    props->>'appVersion'
                FROM analytics.events
                WHERE event_type IN ('api.error', 'api.slow', 'client.error')
                  AND occurred_at_utc >= @since
                  {(endpoint is not null ? "AND props->>'endpoint' ILIKE @ep" : "")}
                ORDER BY occurred_at_utc DESC
                LIMIT @size OFFSET @offset
                """;
            AddParam(dataCmd, "@since", sinceFilter);
            AddParam(dataCmd, "@size", pageSize);
            AddParam(dataCmd, "@offset", (page - 1) * pageSize);
            if (endpoint is not null) AddParam(dataCmd, "@ep", $"%{endpoint}%");

            using var r = await dataCmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(ReadErrorRow(r));
```

The `countCmd` at lines 209-219 is **unchanged** — it counts rows and reads no props beyond the existing endpoint filter.

- [x] **Step 4d: Narrow the two swallows so a broken projection surfaces**

Take a logger on the primary constructor:

```csharp
public sealed class AdminOpsRepository(
    AnalyticsDbContext analyticsContext,
    ILogger<AdminOpsRepository> logger) : IAdminOpsRepository
```

`GetRecentErrorsAsync` is `private static`, so pass the logger in: change its signature to

```csharp
    private static async Task<IReadOnlyList<OpsErrorEventDto>> GetRecentErrorsAsync(
        System.Data.Common.DbConnection conn, ILogger logger, CancellationToken ct)
```

and update its single call site inside `GetOpsHealthAsync` (line 28 — verified 2026-08-30; line 29 is the `GetTopSufferingFarmsAsync` call, do not edit that one) to `await GetRecentErrorsAsync(conn, logger, ct)`.

Replace the bare `catch { /* graceful — returns empty */ }` at line 121 with:

```csharp
        catch (Exception ex)
        {
            // Still graceful — an ops dashboard must not 500 because a props
            // key is missing — but no longer silent. Before 2026-08-30 a wrong
            // projection here returned an empty list and nothing anywhere said
            // why; the admin just saw a blank panel.
            logger.LogWarning(ex,
                "AdminOpsRecentErrorsProjectionFailed. Returning an empty list; the "
                + "/admin/ops/health error panel will be blank until this is fixed.");
        }
```

Replace `catch { return new OpsErrorsPageDto([], 0, page, pageSize); }` at line 253 with:

```csharp
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "AdminOpsErrorsPagedProjectionFailed: page={Page} pageSize={PageSize}. "
                + "Returning an empty page; /admin/ops/errors will look healthy when it is not.",
                page, pageSize);
            return new OpsErrorsPageDto([], 0, page, pageSize);
        }
```

Confirm the DI registration still resolves — `IAdminOpsRepository` is registered by type and `ILogger<T>` is always available from the container, so no registration change is needed. Verify with: `grep -rn "AdminOpsRepository" --include=*.cs src/apps src/AgriSync.Bootstrapper`.

- [x] **Step 5: Run the new tests**

Run: `dotnet test src/tests/ShramSafal.Admin.IntegrationTests/ --filter "FullyQualifiedName~AdminOpsErrorProjection"`
Expected: PASS, all 3 facts. Requires `ADMIN_TESTS_ADMIN_ROOT_CONN` set locally — the fixture throws with the exact instruction if it is not. A `28P01` there is a credential-resolution problem, never a missing secret.

- [x] **Step 6: Run everything**

Run: `dotnet test src/AgriSync.sln --filter "Category!=RequiresDocker"`
Run: `dotnet test src/tests/AgriSync.ArchitectureTests/`
Expected: PASS both.

- [x] **Step 7: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/AdminOpsHealthDto.cs \
        src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/AdminOpsRepository.cs \
        src/tests/ShramSafal.Admin.IntegrationTests/AdminOpsErrorProjectionTests.cs
git commit -m "feat(admin): ops errors carry their code, outcome and explanation

spec: error-capture-engine

OpsErrorEventDto is built positionally in TWO places — GetRecentErrorsAsync
(/admin/ops/health) and GetErrorsPagedAsync (/admin/ops/errors) — so both
projections now go through one shared row reader. New members are nullable:
rows written before this deploy have none of these keys and there is no
backfill. Both catch-alls now log; a wrong projection used to present as a
blank admin panel and say nothing at all."
```

---

## Execution record — code complete 2026-08-31

All nine commits are on `feat/error-capture-engine` in the worktree
`E:/APPS/Running App Versions/agrisync-errcap`, cut from `origin/main` at `c4882ffa`.
**Not pushed. No PR.** Merge to `main` is a founder hard-trigger.

| | Commit | What it did |
|---|---|---|
| Spec | `d1badda` (`_COFOUNDER`) | The spec, `trust_tier: high` |
| 1 | `14efccf4` | Stamping wrapper — the error's name reaches the request context |
| 2 | `64fcd01c` | 27 mappers wrapped + a test pinning the count at 27 |
| 3 | `daace68c` | 58 plain-language explanations |
| 4 | `2ce79182` | The props bag, built testably |
| 5 | `1dcc9ff7` | Unhandled exceptions recorded — they produced **no row at all** before |
| 6 | `f9d5c233` | `errorCode` + `workKept` required; ADR amended (`2fa50a8` in `_COFOUNDER`) |
| — | `37cd7f1c`, `6a7ed15` | Comment sweep: five pointers cited a spec that does not exist |
| 7 | `39612cb3` | The parity gate — the vocabulary judges the middleware |
| 8 | `cbd92f2a` | Carried to `OpsErrorEventDto` and both admin projections |
| — | `6ac28170` | Comments cite methods, not line numbers (Task 8 moved the lines Tasks 5–7 cited) |

**Full suite, measured 2026-08-31 after the last commit** —
`dotnet test src/AgriSync.sln --filter "Category!=RequiresDocker"`:
every project green except `AiEndpointsTests.ReceiptExtract_{DoesNotFallbackToSarvam_WhenGeminiFails,
RejectsUnsupportedImageMimeType}` — 2 failures with **exactly swapped expectations**, confirmed
pre-existing at the stashed baseline and unrelated to this work. `AgriSync.ArchitectureTests` 120/120.
`ShramSafal.Admin.IntegrationTests` green once `ADMIN_TESTS_ADMIN_ROOT_CONN` is derived
(see the standing memory — a missing-connection error here is never a missing secret).

### Open items the founder still owns

1. **Nothing on screen yet.** The six new fields are served by `/admin/ops/errors` and
   `/admin/ops/health`, but no console column draws them. The spec scoped frontend out
   deliberately. After deploy the screen looks **identical** until a separate console plan lands.
2. **The 58 explanations are unverified for truth.** `ErrorExplanationCoverageTests` proves each
   error *has* an explanation; nothing proves any explanation is *correct*.
3. **`/ai/parse-voice-stream` will record `Uncatalogued`.** `AiStreamingEndpoints.cs:152` maps
   `Error → int` rather than `Error → IResult`, so the stamping wrapper cannot see it. The route
   **is** in `CriticalPathFragments`, so it emits — just namelessly. One line, outside this plan.
4. **`RequestObservabilityKeys.UnhandledExceptionType` is a public constant nothing writes.**
   Task 5's design made it unnecessary; its doc was corrected to say so rather than deleted.
   Keep as a documented seam, or remove under YAGNI.
5. **`AdminFarmerHealthRepository` still has ten bare `catch { /* graceful */ }` blocks.**
   Task 8 narrowed both of `AdminOpsRepository`'s. The sibling was out of scope and is untouched,
   so that surface can still fail silently.

---

## 🛑 Founder Acceptance Gate

Do not proceed to deployment until the founder has verified these and ticked the box.

**1. An error now names itself.** With the API running locally and a valid token, trigger a catalogued failure on a **critical write path**. `/logs` is in `CriticalPathFragments`, so a 4xx there is recorded; a 4xx on a read deliberately is not, to avoid noise.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5000/shramsafal/logs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-App-Version: 1.0.9" \
  -d '{"plotId":"00000000-0000-0000-0000-000000000000","logDate":"2026-08-30","tasks":[]}'
```

Then read the row it produced:

```sql
SELECT props->>'errorCode', props->>'workKept', props->>'appVersion',
       props->>'statusCode', props->>'message'
FROM analytics.events WHERE event_type = 'api.error'
ORDER BY occurred_at_utc DESC LIMIT 1;
```

**Expected:** a real error name such as `ShramSafal.PlotNotFound` — **not** null and **not** `Uncatalogued`; `workKept` = `unknown` (honest: nothing observed refused work); `appVersion` = `1.0.9`; `statusCode` = the code curl printed; `message` = the plain-language meaning.

**2. A crash is now recorded at all.** Expected: exit code 0. Before this plan an unhandled exception produced no row whatsoever.

```bash
dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~RequestObservabilityMiddlewareTests"
```

**3. Every mapper records what it answered, and a 28th cannot forget.** Expected: exit code 0.

```bash
dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ErrorCaptureCoverage"
```

**4. Every error explains itself — all 58, across both catalogues.** Expected: exit code 0.

```bash
dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ErrorExplanationCoverage"
```

**5. The contract cannot silently drift, and the gate can fail.** Expected: exit code 0.

```bash
dotnet test src/tests/AgriSync.ArchitectureTests/ --filter "FullyQualifiedName~ApiErrorContractParity"
```

**6. Nothing that read `api.error` before has broken.** Expected: exit code 0. Then load `/admin/ops` and confirm the status badge still renders — it reads `statusCode`, which this plan deliberately did not rename.

```bash
dotnet test src/AgriSync.sln --filter "Category!=RequiresDocker"
```

**Founder approved: [ ]**

---

## Deployment Plan

**Tier:** Data-prod — backend behaviour change on the request path, with **no schema change**.

Because there is **no migration**, this is a binary swap. Deploy via the `agrisync-deploy` plugin (`/deploy`), never hand-rolled.

- [ ] **RG1–RG5 release gates** run at G1 via `release-safety-gates`. Record each verdict verbatim; `NOT_PROVEN` blocks exactly as `FAIL` does.
- [ ] **RDS snapshot floor** taken and confirmed before the swap, per the tracker's rule 6 — even without a migration, so the rollback floor exists.
- [ ] **Wire-contract check before the swap.** This plan touched 27 endpoint files. Confirm in the diff that **every** change is the two-line wrapper plus a rename, and that **no mapper body was edited** — no status code and no response body may move. APK v1.0.9 / versionCode 17 is in the field and bundles its assets at build time, so a changed status code cannot be met with a client fix (`P11`).
- [ ] **Rollback:** binary swap back to the previous `/version` SHA. No down-migration is needed; the new props are additive and the old binary simply stops writing them. Rows written by the new binary read correctly under the old one — every reader uses `props->>'key'` and ignores keys it does not select.
- [ ] **Old-binary compatibility (`E8`):** the previous server must still run against this database. Trivially satisfied — no schema changed — but state it in the Release Record rather than assume it.
- [ ] **Prod proof:** `GET https://api.shramsafal.in/version` returns HTTP 200 with the new build SHA, and `GET /health` returns 200.
- [ ] **Post-deploy evidence — two rows, not one.**
  1. Within an hour of live traffic, at least one `api.error` row carries a non-null `errorCode` that is **not** `Uncatalogued`. A green `/version` says the binary swapped, not that capture works.
  2. `/admin/ops/errors` returns rows whose `meaning` is non-null. If the list comes back empty, read the API log for `AdminOpsErrorsPagedProjectionFailed` — that warning exists precisely because a broken projection used to present as a healthy, empty screen.
- [ ] **Prod is currently hibernated.** `api.shramsafal.in` is intentionally down as a cost saver. Waking it (`bash aws/hibernate/wake.sh`) is an **explicit founder authorisation**, not an implicit step in this plan. If the founder does not judge this change worth a wake on its own, it merges to `main` and rides the next routine deploy — the tracker row is added at merge either way.
- [ ] **`DEPLOYMENT_TRACKER.md` row** added the moment it merges, and a **Release Record** authored at ship time per rulebook §4.2.

**Done means live on prod.** Code-complete ≠ approved; approved ≠ deployed; written ≠ live.



# Planning Directive: Build a Server-Authoritative, Real-World Trust Architecture

Your task is **not to execute changes yet**.

Your task is to inspect the existing architecture and produce the safest executable plan for moving ShramSafal toward a **server-authoritative, multi-device, offline-tolerant architecture where no durable farm truth depends on one device**.

Do not approach this as:

> "Move local data to the server."

Approach it as:

> **Redesign data ownership so the server is the permanent source of truth, while the device remains fast, usable offline, and disposable.**

The plan must solve the **class of architectural problem**, not merely the currently discovered broken fields.

---

# 1. Primary architectural principle

## Server owns truth. Client owns experience.

Every durable business fact must ultimately be reconstructable from server-controlled infrastructure.

Examples include:

- farms
- plots
- crop cycles
- daily logs
- labour records
- costs
- machinery records
- inputs
- irrigation
- planned work
- observations
- verification
- disputes
- payments
- schedules
- farmer-entered values
- derived values
- attachments and their metadata
- relevant provenance/history

The client may maintain:

- temporary cache
- UI state
- downloaded media
- offline outbox
- device preferences
- sync cursor
- unsent work

But none of those may silently become the only permanent copy of business truth.

### Why

A farmer must be able to lose his phone, change his phone, use another device, reinstall the application, or clear application storage without losing successfully synchronized farm history.

---

# 2. Do not design a pure online application

The target is:

**Server-authoritative + offline-tolerant**

not:

**Server-only + internet-required**

Agricultural users will encounter:

- weak connectivity
- intermittent connectivity
- no connectivity inside farms
- interrupted uploads
- application termination
- low-memory devices
- duplicate taps
- network retries
- switching between Wi-Fi and mobile data
- delayed media uploads

The architecture must treat these as normal operating conditions, not edge cases.

Therefore the planning model should be:

```text
User action
    ↓
Internet available?
    │
    ├── Yes → Server transaction → acknowledgement
    │
    └── No  → Durable temporary Outbox
                           ↓
                    retry safely
                           ↓
                    Server transaction
                           ↓
                    acknowledgement
                           ↓
               local pending state removed
```

Offline capability must never create a second permanent database architecture.

---

# 3. Establish a strict data-ownership taxonomy

Before planning migration, inspect every currently persisted object and classify it into exactly one category.

### A. Server Domain Truth

Permanent structured business facts.

### B. Cloud Media

Images, audio, documents and future large binary objects.

### C. Disposable Client Cache

Server-derived information stored locally only for performance.

### D. Offline Outbox

Actions that have happened on the device but have not yet been acknowledged by the server.

### E. Device Preference

Language, last-opened screen, visual preferences and other genuinely device-specific state.

Anything that cannot be classified cleanly is an architectural smell that must be resolved in the plan.

There must be **no hidden sixth category**:

> "Important information that exists permanently only on this phone."

---

# 4. Round-trip fidelity is a hard invariant

For every durable domain object, the planning agent must verify the complete lifecycle:

```text
Create
↓
Serialize
↓
Send
↓
Validate
↓
Persist
↓
Read
↓
Return
↓
Reconstruct
↓
Render
```

Then ask:

> Is the meaning after reconstruction identical to the meaning originally captured?

The answer must be yes.

A record is not "server-backed" merely because *something* reaches the server.

For example, converting a structured machinery record into text notes and later reconstructing another structure is not proper persistence if meaning is lost.

The same applies to irrigation, inputs, financial information, transcripts or any other domain data.

### Why

Data that survives technically but changes meaning is worse than missing data because the farmer may trust a false record.

---

# 5. Never fabricate missing truth

The system must never silently replace unavailable information with convenient defaults.

Forbidden architecture:

```text
Server did not store irrigation method
↓
Client assumes "Drip"
↓
Farmer sees "Drip"
```

Correct architecture:

```text
Server did not store irrigation method
↓
UI knows field is unknown / unavailable
```

Unknown must remain unknown.

Missing must remain missing.

Derived must remain derived.

Inferred must remain inferred.

Farmer-entered must remain farmer-entered.

System-captured must remain system-captured.

### Why

ShramSafal is becoming a trust ledger.

A trustworthy ledger cannot manufacture certainty.

---

# 6. Preserve provenance

The architecture must distinguish the origin of important information.

Conceptually:

```text
Value
Origin
CapturedAt
Actor
Version
Source
Confidence / inference status where relevant
```

Examples:

```text
₹4,500
Farmer stated
```

is different from:

```text
₹4,420
System calculated
```

which is different from:

```text
₹4,500
Legacy value inferred from notes
```

Do not allow one to impersonate another.

### Why

Future features such as:

- labour settlement
- dispute resolution
- cost intelligence
- recommendations
- financing
- insurance
- audit
- reputation
- farmer trust scores

will depend not just on the number but on **where the number came from**.

---

# 7. Design for destructive-device recovery

One of the architecture's most important acceptance scenarios must be:

```text
Farmer uses system for months
↓
Phone is lost/destroyed
↓
Farmer buys another phone
↓
Installs ShramSafal
↓
Authenticates
```

The server must be capable of reconstructing the farmer's durable state.

Not necessarily downloading everything immediately.

But everything that was successfully synchronized must still exist and remain reachable.

This scenario should be treated as a core architectural test, not merely QA.

---

# 8. Separate retention from synchronization

Do not mix these questions:

### Server retention

How long does authoritative historical information remain stored?

### Device synchronization window

How much information does a particular device need locally right now?

These are completely different concerns.

A farmer may have ten years of history on the server while the phone initially receives only:

- active crop cycles
- current plots
- recent activity
- pending work
- summaries
- latest records

Older information can be fetched when required.

### Why

Deleting server history to make mobile synchronization faster is an architectural mistake.

Performance should be solved through selective retrieval, not destruction of truth.

---

# 9. Plan progressive hydration, not database downloading

A new device must not download the farmer's entire historical dataset before becoming usable.

Plan a hierarchy such as:

```text
Authentication
↓
Bootstrap state
↓
Current operational state
↓
Recent history
↓
Older history on demand
↓
Media only when required
```

Use concepts such as:

- bounded queries
- pagination
- cursor pagination
- lazy loading
- thumbnails
- incremental synchronization
- cache revalidation
- delta synchronization

The UI should feel complete quickly even when the total account history is very large.

---

# 10. Treat media as a separate infrastructure concern

Images, audio and future video/files should not determine the architecture of normal structured domain data.

Conceptually:

```text
Structured farm truth → relational/server database

Binary object → object storage

Attachment metadata → database
```

The plan should examine whether media can eventually follow:

```text
Client
↓
authorized upload
↓
object storage
```

rather than unnecessarily forcing every large binary through application-server memory.

Also plan:

- upload retry
- partial failure
- thumbnails
- compression where appropriate
- checksums
- ownership
- authorization
- orphan cleanup
- deletion
- lifecycle policies
- metadata persistence
- download authorization

### Why

Today images may be the largest objects.

Tomorrow the system may contain:

- voice recordings
- videos
- scanned receipts
- worker documents
- crop evidence
- certificates

The architecture should already have the correct boundary.

---

# 11. Synchronization must be one coherent subsystem

Do not permit every feature to invent its own synchronization behaviour.

Plan one general synchronization model that defines:

```text
Pending
Syncing
Committed
Failed
Conflict / requires reconciliation
```

It must define:

- retries
- idempotency
- duplicate submission handling
- ordering where relevant
- server acknowledgement
- versioning
- conflict behaviour
- offline media
- partially completed operations
- authentication expiry during retry
- app termination during synchronization

### Critical invariant

The UI must never say:

> Saved

when the truth is only:

> Saved on this phone and not yet acknowledged by the server.

Farmer-facing states must reflect reality.

---

# 12. Design idempotency deliberately

Real users double-tap.

Networks retry.

Mobile operating systems replay requests.

Outboxes retry after crashes.

Therefore:

```text
same logical command
sent twice
```

must not necessarily create:

```text
two DailyLogs
two payments
two labour events
two attachments
```

The plan must determine where operations require:

- client operation ID
- idempotency key
- unique constraint
- server deduplication
- optimistic concurrency
- version checking

Do not bolt this on after migration.

---

# 13. Multi-device consistency must be intentional

Assume eventually:

```text
Farmer phone
Worker phone
Mukadam phone
Family member phone
Web dashboard
```

may interact with the same farm.

The planning agent must define:

- which server state is authoritative
- how stale clients detect changes
- how updates propagate
- how conflicts are represented
- whether initial implementation uses refresh/delta polling
- where real-time push would later fit

Do not make WebSockets or real-time infrastructure mandatory unless actually justified.

Correctness comes before instantaneous propagation.

---

# 14. Historical data migration must preserve honesty

Some existing records may already have been:

- flattened
- partially synchronized
- reconstructed incorrectly
- stored only on devices
- converted into notes
- duplicated
- transformed using defaults

The plan must **not silently rewrite history**.

For each legacy class, choose consciously among strategies such as:

```text
preserve as legacy
```

or

```text
migrate with provenance
```

or

```text
reconstruct only where deterministic
```

or

```text
mark incomplete
```

Never infer uncertain historical truth and present it as original fact.

The plan must explicitly consider duplicate creation when an old flattened representation and a new properly structured representation meet on the same device.

---

# 15. Partial records must be visible as partial

A record coming from the server must never appear complete if the system knows some important historical fields were never persisted.

Plan an explicit completeness concept where necessary.

For example:

```text
Complete
Legacy partial
Pending synchronization
Media pending
Reconstructed/inferred
```

Exact farmer-facing wording can be decided separately.

Architecture must first make honesty technically possible.

---

# 16. Security and tenancy belong inside the architecture

Moving truth to the server increases responsibility.

The plan must verify that every server-owned object has correct ownership boundaries.

Never rely on:

```text
"The UI doesn't show another farmer's record."
```

Authorization must exist server-side.

The plan should reason through:

```text
User
Owner Account
Farm
Farm Membership
Actor
Worker
Operator
```

and ensure data cannot cross tenant or farm boundaries accidentally.

This is especially important once the same person can participate in multiple farms or roles.

---

# 17. Auditability must survive migration

For trust-sensitive mutations, preserve enough information to answer:

```text
Who did it?
When?
On which farm?
What changed?
What was the previous value?
Was it farmer-entered, inferred or calculated?
Was it later corrected?
```

Do not overwrite important historical facts merely to keep the current row simple.

Corrections should retain traceability where the domain requires it.

---

# 18. Plan failure states before success states

For every important workflow, design the failure path alongside the happy path.

Examples:

### Log saved, image upload failed

The log should not disappear.

### Image uploaded, API commit failed

Do not permanently leak orphan media.

### Server committed, acknowledgement never reached phone

Retry must not duplicate the operation.

### Authentication expires while outbox contains data

Do not silently delete the outbox.

### App closes during synchronization

Recovery must be deterministic.

### Two devices modify the same record

Do not resolve silently unless business semantics make the winner deterministic.

### Server temporarily unavailable

Existing useful cached information should remain usable where safe.

Real-world reliability is largely the architecture of these failure states.

---

# 19. Observability must expose truth

The plan must ensure production debugging can answer:

```text
Did the user perform the action?
Did it enter the outbox?
Was it sent?
Did the API receive it?
Did validation fail?
Was the DB transaction committed?
Was media uploaded?
What server version was returned?
What did the client finally render?
```

Without this, sync problems become impossible to distinguish from farmer mistakes.

Plan:

- correlation IDs
- structured errors
- sync diagnostics
- failed-outbox visibility
- server-side telemetry
- attachment lifecycle visibility

Do not expose technical complexity to farmers, but make it diagnosable internally.

---

# 20. Performance should be solved without corrupting architecture

Do not introduce premature complexity such as:

- microservices
- Kafka everywhere
- Kubernetes
- multiple databases without need
- elaborate event sourcing
- custom CDN infrastructure

First exhaust the simpler scalable architecture:

```text
modular backend
+
relational authoritative database
+
object storage
+
CDN where needed
+
background processing
+
bounded server queries
+
client cache
+
offline outbox
```

Scale should come through clear boundaries before distributed-system complexity.

---

# 21. Migration must be evolutionary, not a big-bang rewrite

The plan should find a safe sequence that allows the existing application to continue functioning during migration.

Do not assume every domain can be switched simultaneously.

The plan should discover dependencies and establish stages where:

```text
server capability exists
before
client permanently depends on it
```

and:

```text
server read-back works correctly
before
old client-only representation is removed
```

Every transition should have a rollback or compatibility story.

The planning agent must determine the exact implementation sequence after inspecting the repository.

---

# 22. Do not optimize the plan around current filenames

Files are implementation details.

Plan around architectural capabilities:

1. authoritative storage
2. complete contracts
3. write fidelity
4. read fidelity
5. reconstruction fidelity
6. offline mutation handling
7. media lifecycle
8. synchronization
9. multi-device behaviour
10. legacy migration
11. observability
12. security
13. deployment compatibility

Only after these are clear should the plan map them onto actual files, migrations and code surfaces.

---

# 23. Planning methodology required

Before producing implementation tasks, perform an architecture discovery pass.

For every persisted domain concept determine:

```text
Where is it created?
Where is it stored locally?
Does the server know it exists?
What exact shape reaches the server?
Where is it persisted?
Can the server read it back?
Does the client reconstruct the identical meaning?
What happens on another device?
What happens offline?
What happens after local storage deletion?
What happens to existing historical versions?
```

Produce a **Data Ownership Matrix**.

Example structure:

| Domain concept | Current authority | Server write | Server read | Round-trip fidelity | Offline behaviour | New-device recovery | Target authority |
| -------------- | ----------------- | ------------ | ----------- | ------------------- | ----------------- | ------------------- | ---------------- |

Do not assume a feature works merely because there is an API call associated with it.

Verify the complete round trip.

---

# 24. The planning agent's core acceptance invariants

The final execution plan must make these outcomes achievable.

### Invariant 1 — No local-only durable truth

Any acknowledged durable business action survives destruction of the originating device.

### Invariant 2 — Exact semantic round trip

Server persistence cannot silently change the meaning of what the farmer recorded.

### Invariant 3 — No fabricated reconstruction

Unknown data remains unknown.

### Invariant 4 — Offline work is protected

Network loss cannot casually destroy captured work.

### Invariant 5 — Retry is safe

Repeated transmission does not corrupt or duplicate important business state.

### Invariant 6 — New-device recovery works

A newly authenticated device can reconstruct authoritative farm history from the server.

### Invariant 7 — Large history remains usable

Ten years of server history does not imply downloading ten years during startup.

### Invariant 8 — Media scale is independent

Thousands of images/audio files do not overload ordinary domain APIs or relational reads.

### Invariant 9 — Provenance survives

Farmer-entered, calculated, system-captured and inferred information remain distinguishable.

### Invariant 10 — Partial truth is never presented as complete truth

The system is explicit about incomplete, pending, legacy or inferred state.

### Invariant 11 — Multi-device access cannot create competing truths

The server remains canonical.

### Invariant 12 — Cache destruction is safe

Deleting disposable local cache cannot destroy acknowledged business history.

---

# 25. Real-life scenarios the plan must explicitly test

Do not validate this architecture only with unit-level happy paths.

The plan must include scenario-level verification for at least:

1. Farmer creates records online and logs in from a second device.
2. Farmer creates records completely offline and reconnects later.
3. Connectivity disappears halfway through synchronization.
4. Application is killed while an upload is happening.
5. Same outbox command is retried multiple times.
6. Farmer deletes/reinstalls the app.
7. Device local database is deliberately wiped.
8. Farmer has several years of records and thousands of images.
9. Two devices view or modify the same farm.
10. Structured record contains fields older server versions did not understand.
11. Old malformed/flattened historical data meets the new model.
12. Media succeeds while metadata fails, and vice versa.
13. Authorization expires with unsynchronized work remaining.
14. Server is temporarily unavailable.
15. User explicitly deletes a record and deletion must propagate correctly.

Focus testing investment on these trust boundaries rather than creating large quantities of low-value tests around implementation details.

---

# 26. What the resulting plan must contain

Once discovery is complete, produce an execution plan containing:

### A. Current-state architecture map

What actually exists, not what documentation claims exists.

### B. Violation inventory

Every place where the architectural invariants currently fail.

### C. Target architecture

Clear ownership and synchronization model.

### D. Migration sequencing

Safe dependency-ordered stages.

### E. Change surface

Database, backend, frontend, contracts, storage, synchronization, infrastructure and deployment implications.

### F. Legacy-data strategy

Including incomplete and previously mangled records.

### G. Failure-mode strategy

Not only happy paths.

### H. Acceptance gates

Evidence that each architectural invariant has been achieved.

### I. Deployment and rollback strategy

Including backward compatibility where old clients/server versions may coexist.

### J. Explicit deferrals

Anything discovered but intentionally not repaired now must be named rather than silently ignored.

---

# Final planning doctrine

Do not plan this as a feature.

Do not plan it as a database migration.

Do not plan it as "replace localStorage."

Do not plan it as "make the app like Telegram."

Plan it as:

> **A migration from fragmented device-dependent state to a server-authoritative trust architecture, while preserving the realities of unreliable rural connectivity.**

The defining architecture should eventually be:

```text
SERVER
    = permanent truth

OBJECT STORAGE
    = permanent binary truth

CLIENT CACHE
    = disposable performance layer

OFFLINE OUTBOX
    = temporary unsynchronized intent

SYNC SYSTEM
    = bridge between them
```

The ultimate test is brutally simple:

> **If a farmer throws his phone into a well after synchronization, buys another phone, logs in, and continues working without losing or falsifying his farm history, the architecture is doing its job.**

Produce the plan around that standard.

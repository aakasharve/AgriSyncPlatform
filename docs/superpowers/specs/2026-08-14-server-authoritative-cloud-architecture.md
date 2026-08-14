# Server-Authoritative Cloud Architecture

### with Ephemeral Client Cache + Bounded Offline Outbox

**Status:** Founder-supplied architectural direction · **Author:** Founder · **Received:** 2026-08-14
**Branch:** `feat/server-authoritative-architecture`
**Supersedes the framing of:** `docs/superpowers/plans/2026-08-14-telegram-style-server-migration-HANDOFF.md`

> **What this document is.** The handoff describes *what is missing* from the server, measured against
> the real schema. This document describes *how to think about the target*. Where the two differ in
> framing, this one governs: the handoff's four-category gap list is one phase of the work described
> here, not the whole of it.

> **What this document is not.** It is not literal Telegram architecture. Telegram's complete backend
> is not publicly documented. What is being adopted is the **data ownership model**, not the
> implementation.

---

## The one-line statement

> **Server owns the truth. Device owns only a temporary view of the truth.**

Telegram describes its cloud chats as server-stored so messages and media can be accessed from any
device. Its client stack still uses local storage and cache for performance. So the important
distinction is **not** "no device storage". It is that **device storage is disposable**.

---

## 1. First-principles distinction

Three fundamentally different architectures.

### A. Local-first

```text
PHONE = truth
     ↓
SERVER = backup/sync
```

Danger:

* change phone → possible missing data
* clear browser/app storage → possible loss
* multiple devices → conflict resolution becomes difficult
* business logic gradually leaks into client persistence

This is what we are escaping.

### B. Pure server-only

```text
PHONE
 ↓
Internet
 ↓
SERVER = everything
```

Conceptually clean, dangerous for rural agriculture. One weak network connection and the farmer
cannot even complete today's work.

### C. The target

```text
               SERVER
              = TRUTH
                 │
       ┌─────────┼──────────┐
       │         │          │
     Phone A   Phone B     Web
       │         │          │
      Cache     Cache      Cache
       │
   Temporary Outbox
   only when offline
```

The device can temporarily remember things. But **nothing becomes permanent business truth merely
because it exists on that device.**

---

## 2. Four architectural planes

### Plane 1 — Truth Plane

Real structured business data:

```text
User
Farm
Plot
CropCycle
DailyLog
LabourWork
Worker
Attendance
CostEntry
Schedule
Verification
Dispute
Payment
Attachment metadata
AI output/provenance
```

Lives in the authoritative server database.

```text
PostgreSQL
     ↑
 Application/API
     ↑
    Client
```

On a brand-new phone, these entities are reconstructed entirely from the server.

#### The golden test

> "If I destroy this farmer's phone right now, can the complete farm state be reconstructed?"

**Yes** → architecture is correct.
**No** → some domain truth is still trapped on the client.

---

### Plane 2 — Media Plane

Images, audio, and future video.

PostgreSQL is **not** the image warehouse. The database knows:

```text
AttachmentId
Owner/Farm
DailyLogId
ObjectKey
MediaType
CreatedAt
UploadedBy
Checksum
Size
ThumbnailKey
Status
```

The 3 MB image itself lives in object storage.

```text
DailyLog
   │
   ├── text/data ───────────> PostgreSQL
   │
   └── image reference ─────> PostgreSQL
                                 │
                                 ↓
                             S3 Object
```

Clients upload directly to S3 through temporary presigned URLs instead of the API server carrying the
binary. So a 10 MB photograph does **not** travel:

```text
Phone → .NET API → server RAM → S3
```

It travels:

```text
Phone ───────────────→ S3

      metadata only
Phone → API → Database
```

This matters more as media grows.

#### Read path

```text
                 ┌──────── PostgreSQL
                 │
Mobile → API ────┤
                 │
                 └──────── S3
                            │
                            ↓
                       CloudFront
                            │
                            ↓
                         Mobile
```

CloudFront distributes content such as images through edge locations nearer to users.

#### Resolution tiers

Never show a 5 MB original where a 100 KB thumbnail will do.

```text
Original
Thumbnail
possibly medium-resolution version
```

* Log list → thumbnail
* Open photograph → medium / original

That is how enormous media libraries still *feel* lightweight.

#### One media model, not four

No architectural distinction between:

```text
Image
Audio
Video
PDF
```

They are all **binary objects with metadata**.

```text
Attachment
 ├── Image
 ├── Audio
 ├── Video
 └── Document
```

Domain references them. Object store contains them. If voice recordings later become unnecessary once
transcription and provenance requirements are satisfied, retention rules can delete them. That is a
**product / data-governance decision, not a client-storage limitation.**

---

### Plane 3 — Sync Plane

The client must never ask:

> "Which version is correct, my local one or the server one?"

There is one answer:

> **Server version is correct unless this device has an acknowledged pending mutation that has not
> yet reached the server.**

Online path:

```text
Farmer
  ↓
Client
  ↓
POST command
  ↓
Server validates
  ↓
Database commits
  ↓
Server returns canonical entity
  ↓
UI updates
```

The client renders the **server-confirmed result** rather than inventing its own permanent entity.

#### Offline path

Farmer in the field, no internet, records: 4 workers, 2 acres, ₹2,400, photo, voice note.

The phone temporarily stores:

```text
PendingMutation {
    clientRequestId
    command
    capturedAt
    mediaReference
    syncStatus = Pending
}
```

When internet returns:

```text
Pending
   ↓
Uploading
   ↓
Server received
   ↓
Committed
   ↓
Acknowledged
   ↓
Remove local pending mutation
```

The local database becomes **a mailbox waiting to deliver information**, not **the permanent farm
database**. That is the architectural difference.

---

### Plane 4 — Change / update feed

Multiple people on one farm: owner's phone, worker's phone, mukadam's phone, web dashboard. Nobody
should refresh manually.

```text
Worker
  ↓
Server
  ↓
Database
  ↓
Change notification
  ↓
Owner devices
```

Transport can be WebSocket, SSE, push, or periodic delta sync. Full real-time infrastructure is not
needed initially. The powerful primitive is a cursor:

```text
GET /changes?after=91882
```

```text
91900 DailyLog created
91904 LabourWork changed
91907 Payment confirmed
```

Client applies only changes since its last known cursor.

---

## 3. Device storage has exactly five jobs

Every existing client-side persistence mechanism is classified against these.

1. **Authentication material** — enough to authenticate the device securely.
2. **UI cache** — recent farms, plots, recent logs. Purely for speed.
3. **Media cache** — thumbnails and recent photographs. Disposable.
4. **Offline outbox** — created while offline, not yet accepted by the server.
5. **Sync cursor / preferences** — `lastServerRevision`, `language`, `selectedFarm`.

Everything else deserves suspicion.

### The classification rule

| Data                  | Owner                   |
| --------------------- | ----------------------- |
| Business/domain truth | Server DB               |
| Images/audio/files    | Object storage          |
| Performance copy      | Disposable client cache |
| Unsynced user action  | Temporary client outbox |

There is **no fifth category** called *"Important data that only exists in local storage."* That
category must disappear.

---

## 4. Why this stays fast

Telegram does **not** download your entire history on launch.

> **Don't load everything. Load exactly what the eyes need now.**

A farmer with 8 years, 20 plots, 40 crop cycles, 15,000 work logs, 12,000 photographs and crores of
transaction history. The home screen requests only:

```text
Farm summary
Today's plots
Recent 10 logs
Pending 3 works
Current crop cycle
Tiny image thumbnails
```

50 to 200 KB. Not 20 GB. Then:

```text
Scroll        → next 20 records
Open crop     → that crop's data
Open photo    → high-resolution image
Open season   → that season's history
```

Pagination, lazy loading, query-specific APIs. Not downloading the database.

### The "instant new device" sequence

1. Login.
2. Server returns a **bootstrap snapshot**: identity, farm memberships, current farm, plots, active
   crop cycles, today's status, recent activity, pending work, summary metrics.
3. UI is usable immediately.
4. The rest arrives progressively: older logs → older images → previous crop cycles → historical
   payments.

The farmer thinks *"my whole farm is here."* Perhaps 1% of the data has reached the phone.

---

## 5. The invariants

### Invariant 1 — no local-only truth

> **No successful business mutation may permanently exist only on one client device.**

Applies to: Create DailyLog · Verify Work · Record Labour · Add Cost · Complete Task · Create
Schedule · Upload Attachment · Record Payment · Correct Finance.

Two legal states:

```text
State A — Pending locally    (NOT YET SERVER COMMITTED)
State B — Server committed   (SERVER IS AUTHORITATIVE)
```

Never:

```text
State C — "Saved successfully" but actually only stored in local DB.
```

State C must become architecturally impossible.

### Invariant 2 — local cache must be destroyable

```text
1. Use app for 6 months.
2. Delete app.
3. Install on new phone.
4. Login.
```

Expected: farms ✓ plots ✓ crop cycles ✓ logs ✓ labour ✓ costs ✓ schedules ✓ verification ✓
payments ✓ images ✓ historical data ✓

The only acceptable losses: unsynced offline actions, temporary downloaded files, UI preferences that
were intentionally device-specific.

Anything else that disappears is an architectural leak.

---

## 6. Keep the thin client. Tighten the ownership boundary.

The problem is most likely **not** *"thin client was the wrong approach."* It is that **some local
persistence gradually became domain ownership.** Those are completely different things.

Thin should mean:

```text
UI + interaction + temporary cache + offline transport
```

Not:

```text
UI + private database containing pieces of business truth unknown to server
```

---

## 7. What NOT to build

Not needed: microservices · Kafka everywhere · Kubernetes · distributed databases · event sourcing
everywhere · Telegram-style global data centres · complex Redis architecture · own CDN · own object
storage.

Those solve a problem we do not have. The architecture stays:

```text
.NET modular monolith
        +
PostgreSQL
        +
S3
        +
CloudFront
        +
background worker
        +
server-authoritative API
        +
small offline outbox
```

S3 and CloudFront already provide storage and delivery of large binary content without forcing those
binaries through the relational database or the application server. This scales very far before
Telegram-level distributed infrastructure is needed.

---

## 8. Execution mandate

### Phase A — Establish ownership

Inspect every persisted data type. Classify it:

```text
SERVER TRUTH
MEDIA OBJECT
CLIENT CACHE
OFFLINE OUTBOX
DEVICE PREFERENCE
```

Anything ambiguous requires architectural resolution **before** migration.

### Phase B — Establish server authority

Every durable business entity must have: server identity · authorization boundary · server
validation · server persistence · server timestamps/version · actor identity · idempotent mutation
semantics where required.

### Phase C — Establish client semantics

The client must distinguish:

```text
cached
pending
syncing
committed
failed
```

Never call `pending` data successfully persisted.

### Phase D — Separate media

```text
client → authorized upload → object storage
API    → metadata/reference → database
```

Not binary blobs inside normal business-state persistence.

### Phase E — Server-driven reads

Screens reconstruct themselves from server queries: summary queries, pagination, cursor pagination,
lazy loading, bounded recent history. Not by downloading an entire farm.

### Phase F — Synchronization

One coherent mechanism for: initial bootstrap · delta refresh · offline reconciliation ·
idempotency · version/conflict handling · retry. Avoid feature-by-feature synchronization
implementations.

### Phase G — Kill hidden truth

Deliberately test:

```text
clear all client persisted state
restart
login
```

The application reconstructs itself. **This becomes an architectural acceptance gate.**

---

## 9. The hard instruction to the executing agent

> **Do not perform a "storage migration." Perform a "source-of-truth migration."**
>
> The goal is not to reduce IndexedDB/localStorage usage. Local storage may continue to exist for
> cache and offline reliability.
>
> The goal is to guarantee that every durable domain object is server-authoritative, every binary
> object is cloud-authoritative, and every client-side copy is either disposable cache or explicitly
> unsynced work.
>
> Preserve rural offline usability, but never allow offline capability to become a second database
> architecture.
>
> Optimize loading through bounded queries, pagination, lazy media loading, thumbnails, cache and
> delta synchronization. Never by keeping hidden authoritative state permanently on the device.
>
> Before changing implementation, map the current persistence architecture against these invariants,
> identify violations, and design the migration sequence from architectural ownership rather than
> file locations.

---

## 10. The mental model

The fear:

```text
"If everything is on server, won't we have to download everything?"
```

No.

```text
SERVER OWNS EVERYTHING

DEVICE KNOWS
ONLY WHAT IT NEEDS NOW

CDN DELIVERS
ONLY THE MEDIA IT NEEDS NOW

CACHE REMEMBERS
WHAT MAY BE NEEDED AGAIN

OUTBOX PROTECTS
WHAT HAS NOT REACHED SERVER YET
```

Take a new phone, log in, and the farm reappears, while the app stays fast even after ten years of
logs and thousands of images.

---

## 11. The question the next architectural review answers

> **"Where does authoritative state live for every data type?"**

Do that classification **before** allowing any agent to modify code.

---

## Sources

- Telegram Privacy Policy — cloud chat storage: https://telegram.org/privacy
- Telegram — uploading and downloading files: https://core.telegram.org/api/files
- Telegram — working with updates: https://core.telegram.org/api/updates
- AWS — uploading objects with presigned URLs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
- AWS — what is Amazon CloudFront: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html

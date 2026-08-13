---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-08-10
scope_description: "Video upload/processing backbone: message queue technology, large-file (10GB) upload strategy, object storage key/bucket layout, video worker execution and metadata/thumbnail extraction, unique video URL, streaming/download delivery, and the video status lifecycle."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the video upload/pre-registration endpoints, publishes and consumes background processing jobs, talks to Object Storage, and exposes streaming/download/status endpoints. All decisions in this document apply here.
- `next-frontend/` — no capability bullet in Fase 03's scope per `docs/project-plan.md` (Fase 03 has no UI bullets; the video upload/management UI arrives in Fase 04 and the watch/player UI in Fase 05). The challenge description explicitly frames Fase 03 as backend-only. No open decision in this document.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram (`docs/diagrams/software-arch.mermaid`) marks the Message Queue container as `TBD` — this is the phase's central open stack decision. The queue carries one job type (video processing) from the API to the Video Worker after upload completes. The installed stack already has PostgreSQL 17 (`nestjs-project/compose.yaml`) and no Redis or broker of any kind.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Redis-backed job queue with an official-pattern NestJS integration (`@nestjs/bullmq`): `BullModule.registerQueue()` on the producer side, `@Processor()`/`@Worker()` classes on the consumer side. Runs as a new `redis` service in `compose.yaml`.
- **Pros:** Most-documented queue pattern in the NestJS ecosystem; native retry with exponential backoff, delayed jobs, and per-job concurrency control — all directly useful for a heavy, failure-prone job like video transcoding; ships an inspectable dashboard (Bull Board) for observability during development; the queue is a clearly distinct, independently verifiable infra component (satisfies "fila real subindo no Compose" unambiguously).
- **Cons:** Adds Redis as an entirely new infra dependency with its own container, volume, and failure mode; job state lives outside PostgreSQL (no single transactional boundary between "create draft video row" and "enqueue processing job").

### Option B: pg-boss (PostgreSQL-backed queue)
- Queue implemented as tables inside the existing PostgreSQL database, using `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrent consumption. No new datastore — `pg-boss` runs against the same `db` service already in `compose.yaml`.
- **Pros:** Zero new infrastructure — reuses the already-healthy `db` service; enqueueing a job can happen in the same DB transaction as inserting the draft video row (true atomicity, no dual-write problem); consistent with this project's existing bias toward reusing PostgreSQL instead of adding Redis (see `technical-decisions-phase-02-auth.md` TD-03, which chose DB-stored refresh tokens explicitly "no need for Redis — PostgreSQL already in stack").
- **Cons:** Lower throughput ceiling than Redis-backed queues (irrelevant at this project's scale, but a real trade-off); "the fila" isn't a separately visible container in `docker compose ps`, which is harder to point at as distinct new infra when demonstrating the phase; less job-queue-specific tooling (no dashboard) than BullMQ.

### Option C: RabbitMQ (`amqplib` / `@nestjs/microservices` RMQ transport)
- Dedicated AMQP broker, consumed via NestJS's built-in RabbitMQ microservice transport. Runs as a new `rabbitmq` service in `compose.yaml`.
- **Pros:** Purpose-built message broker with strong delivery guarantees and routing flexibility (exchanges/routing keys) if the job model grows beyond a single job type; official NestJS microservices transport exists out of the box.
- **Cons:** Heaviest operational footprint of the three (separate broker, management UI, its own tuning); the project has exactly one job type today (process an uploaded video) — RabbitMQ's routing/exchange flexibility is unused complexity; NestJS's RMQ microservice transport is a different programming model (`@MessagePattern`/`@EventPattern`) than the simpler job-queue APIs of the other two options.

**Recommendation:** **Option A (BullMQ + Redis)** — video processing jobs are long-running, resource-heavy, and failure-prone (corrupt uploads, unsupported codecs, worker crashes mid-transcode), which is exactly BullMQ's strength: built-in retry/backoff, stalled-job recovery, and concurrency limits without custom code. It is also the most unambiguous way to satisfy the phase's explicit requirement that a real, distinct queue is running in Compose — pg-boss's "queue" would be invisible as a container, which is a weaker demonstration of the architecture even though it is a legitimate and lower-footprint choice. Redis is a small, well-understood addition to the Compose stack.

**Decision:** Option A

---

## TD-02: Large File (10GB) Upload Strategy

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** `docs/project-plan.md` § Pontos de Atenção is explicit: "o upload de até 10GB precisa ser feito de forma que não trave o sistema e permita retomar em caso de falha de conexão." Passing a 10GB body through the NestJS process (buffering or even fully streaming it through a single request handler) ties up a connection/worker thread for the entire transfer and makes the API's own memory/CPU budget scale with concurrent uploads — the failure mode the requirement is warning against.

**Options:**

### Option A: Direct-to-storage upload via S3/MinIO multipart + presigned URLs
- The API never receives the video bytes. It creates the draft video row, initiates a multipart upload against Object Storage (`CreateMultipartUpload`), and returns presigned PUT URLs per part (each part ≤ 5GB, well within S3/MinIO limits for a 10GB file split into a handful of parts). The client (or a test script, since no frontend is in scope) uploads parts directly to storage and calls a `complete` endpoint with the returned ETags; the API then calls `CompleteMultipartUpload` and flips the video to `uploaded`.
- **Pros:** Matches the architecture diagram's `frontend → storage: Streams (HTTPS)` relationship — the API is a control-plane only, never a data-plane, for the upload; parts can be retried individually if a connection drops (server-side resumability at the part level); no impact on API memory/CPU regardless of file size or concurrent uploads.
- **Cons:** Requires a multi-step client protocol (initiate → per-part PUT → complete) instead of a single request — more surface area for the API contract (three endpoints instead of one) and requires the client to track part ETags.

### Option B: Streaming proxy through the API (busboy/stream pipe, no buffering)
- The API accepts a single `multipart/form-data` (or raw body) request and pipes the incoming stream directly to a storage `PutObject`/streaming upload, never buffering the full file in memory.
- **Pros:** Single endpoint, simplest client contract (one HTTP request); no multipart-protocol bookkeeping.
- **Cons:** This is exactly the "pass the whole file through the API" path the assignment calls out as the wrong approach — even without buffering, the request holds an API connection/worker open for the entire transfer duration (potentially hours for 10GB on a slow link), so concurrent large uploads still degrade the API's ability to serve other requests; no part-level resumability — a dropped connection loses the whole upload; violates the "sem impacto na performance" requirement more directly than Option A.

### Option C: tus resumable protocol (self-hosted `tusd` or `tus-node-server`)
- Implements the open TUS protocol (byte-offset `HEAD`/`PATCH` resumability) either via a dedicated `tusd` binary (new infra component) or an in-API `tus-node-server` with an S3 data-store.
- **Pros:** True byte-level resumability (resume from the exact last received byte, not just the last completed part) — the strongest fit for "permita retomar em caso de falha de conexão."
- **Cons:** `tusd` as a standalone binary is a new infra component beyond what the phase already needs (storage, queue, worker); `tus-node-server` embedded in the API still routes upload bytes through the Node process before/while relaying to S3, only partially avoiding the Option B problem depending on configuration; protocol and tooling are unfamiliar relative to the project's existing AWS-SDK-based patterns.

**Recommendation:** **Option A (direct-to-storage multipart + presigned URLs)** — it is the only option that keeps the API fully off the data path for the actual bytes, which is what "sem impacto na performance" requires at 10GB scale, and it reuses the same `@aws-sdk/client-s3` dependency needed for TD-03/TD-06 rather than introducing a dedicated upload server. Part-level retry covers the "retomar em caso de falha" requirement adequately for this phase's scope; true byte-level resume (Option C) is a refinement that can be revisited later if part-level granularity proves insufficient.

**Decision:** Option A

---

## TD-03: Object Storage Key/Bucket Organization

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The storage technology itself is not open — the architecture diagram fixes it as S3-compatible (MinIO locally, S3 in production). What is open is how the API organizes objects (bucket layout, key naming) and which SDK it uses to talk to storage, since that SDK also underlies TD-02's presigned multipart upload and TD-06's presigned streaming/download URLs.

**Options:**

### Option A: Single bucket, hierarchical keys, `@aws-sdk/client-s3`
- One bucket (e.g. `streamtube`), with keys namespaced by entity: `videos/{channelId}/{videoId}/original.<ext>` and `videos/{channelId}/{videoId}/thumbnail.jpg`. All storage calls (multipart upload, presigned GET) go through `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, configured with a custom `endpoint` pointing at the `minio` Compose service.
- **Pros:** `@aws-sdk/client-s3` is the vendor-neutral S3 client — the exact same code runs unmodified against MinIO in dev and real AWS S3 (or any S3-compatible provider) in production, matching the diagram's "S3 or MinIO" framing; a single bucket keeps IAM/policy and lifecycle-rule surface small for a project this size; the key hierarchy gives the same logical separation multiple buckets would, without bucket-count sprawl.
- **Cons:** All object types share one bucket-level policy/lifecycle configuration — a future need for per-type lifecycle rules (e.g., auto-expire raw uploads but keep processed output forever) would require prefix-scoped lifecycle rules instead of bucket-scoped ones (S3 supports this, so it's a minor limitation).

### Option B: Multiple buckets by content type (`videos-raw`, `videos-processed`, `thumbnails`)
- Separate buckets per object category, still via `@aws-sdk/client-s3`.
- **Pros:** Cleaner blast-radius isolation (a misconfigured policy on one bucket doesn't affect others); bucket-level lifecycle rules apply cleanly per content type without prefix scoping.
- **Cons:** More buckets to create/provision (MinIO bucket bootstrap, IAM policy per bucket) for a single-worker, single-job-type pipeline that doesn't yet need that isolation; more moving parts in `library-refs.md`/setup scripts for no near-term benefit.

### Option C: MinIO-native SDK (`minio` npm package)
- Use the MinIO JavaScript client instead of the AWS SDK.
- **Pros:** Slightly simpler convenience methods for presigned URLs (`presignedPutObject`/`presignedGetObject`) with fewer imports than AWS SDK's split packages (`client-s3` + `s3-request-presigner`).
- **Cons:** MinIO-specific — the same code would need to be swapped for `@aws-sdk/client-s3` (or reconfigured) if production moves to real AWS S3 or another S3-compatible provider, which directly contradicts the architecture diagram's explicit "S3 or MinIO" flexibility; smaller ecosystem/community than the AWS SDK for multipart-upload edge cases.

**Recommendation:** **Option A (single bucket, hierarchical keys, `@aws-sdk/client-s3`)** — vendor neutrality is the deciding factor: the project's own architecture diagram treats S3 and MinIO as interchangeable, and `@aws-sdk/client-s3` is what makes that interchangeability real in code. A single bucket with hierarchical keys is the simplest layout that still cleanly separates videos and thumbnails per channel/video, appropriate for this project's scale.

**Decision:** Option A

---

## TD-04: Video Worker Execution & Processing (Metadata + Thumbnail)

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The architecture diagram fixes FFmpeg as the Video Worker's technology, but not how the worker is deployed relative to the NestJS API, nor how it invokes FFmpeg/FFprobe. This decision also depends on TD-01 (queue technology), since the worker's consumption model follows whatever library TD-01 picks.

**Options:**

### Option A: Separate NestJS standalone application + direct `child_process` FFmpeg/FFprobe calls
- A second Nest application context (`NestFactory.createApplicationContext`, its own `main.ts`/entry point), reusing the same `VideosModule` entities/services/config via DI, running as its own service in `compose.yaml` (matching the diagram's distinct "Video Worker" container). The job handler (`@Processor` if TD-01 chose BullMQ) calls `ffprobe -print_format json -show_format -show_streams` (via `child_process.execFile`) to extract duration/metadata, and `ffmpeg -ss <t> -i <input> -frames:v 1` to extract a thumbnail frame — both invoked directly, not through `fluent-ffmpeg` (archived/unmaintained as of May 2025, and no longer reliable with current FFmpeg versions).
- **Pros:** Reuses the project's existing DI, TypeORM entities/repositories, and `ConfigModule` setup instead of duplicating data-access code in a bare script; matches the architecture diagram's distinct "Video Worker" container 1:1; `child_process` + raw FFmpeg/FFprobe avoids depending on an archived library.
- **Cons:** Two Nest entry points to build/maintain (`dist/main.js` for the API, `dist/worker/main.js` for the worker) with shared `nest-cli.json` config; slightly more Docker/build setup than a single-entrypoint app.

### Option B: Plain Node.js script (no NestJS DI), direct `child_process` FFmpeg/FFprobe calls
- A standalone script outside Nest's module system, connecting to the DB and queue with raw clients (`pg`/`TypeORM DataSource` manually instantiated, queue client library directly).
- **Pros:** Minimal framework overhead; no need to reconcile two Nest applications' build output.
- **Cons:** Duplicates entity definitions or requires importing `src/**/*.entity.ts` outside Nest's DI, losing the project's established repository-injection pattern; loses `ConfigModule`'s Joi-validated config loading, so environment handling has to be reimplemented; diverges from every other part of the codebase, which is 100% NestJS-idiomatic.

### Option C: NestJS hybrid microservice (`@MessagePattern`/`@EventPattern` over the queue transport)
- The worker is a NestJS microservice using the built-in transport abstraction, with FFmpeg invocation same as Option A.
- **Pros:** Same DI reuse benefits as Option A, plus a transport-agnostic consumption API if the queue technology changes later.
- **Cons:** NestJS's microservice `@MessagePattern` model doesn't have first-class support for BullMQ (BullMQ integrates via `@nestjs/bullmq`'s own `@Processor` class, not the generic microservices transport layer) — adopting this option would fight the natural integration point for whichever queue TD-01 picks, adding an unnecessary abstraction layer.

**Recommendation:** **Option A (separate NestJS standalone app, `child_process` FFmpeg/FFprobe)** — it is the only option that both matches the diagram's "Video Worker" as a genuinely separate deployable and stays idiomatic with the rest of the (100% NestJS) codebase. Direct `child_process` calls to FFmpeg/FFprobe are chosen over `fluent-ffmpeg` specifically because that library is archived and known to misbehave with current FFmpeg — a dependency that would be inherited as unmaintained on day one.

**Decision:** Option A

---

## TD-05: Unique Video URL / Public Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** `docs/project-plan.md` § Pontos de Atenção is explicit that the URL must be both unique AND short: "cada vídeo precisa de uma URL curta e única que nunca conflite com outro vídeo." Every entity in the project uses a UUID primary key (`nestjs-entities.md` convention), but a raw UUID (36 chars) does not satisfy "curta." `ChannelsService.createChannel()` already established a precedent for a separate, short, unique, collision-checked public identifier (the channel `nickname`), generated with a `DataSource.transaction()` + SAVEPOINT retry loop on unique-constraint violation.

**Options:**

### Option A: Use the video's UUID primary key directly as the public identifier
- No separate slug column; `GET /videos/:id` and streaming/download URLs use the entity's own UUID.
- **Pros:** Zero extra columns, zero collision handling needed (UUIDv4 collision probability is negligible); simplest possible implementation.
- **Cons:** Directly fails the explicit "URL curta" requirement — a UUID is 36 characters, far longer than a YouTube-style short video ID; no precedent for this being acceptable elsewhere in the project (the one other public-facing identifier, the channel nickname, is deliberately short).

### Option B: Separate short slug via `nanoid`, unique-indexed column, collision-retry
- A dedicated `slug` (or `public_id`) column on the video entity, generated with `nanoid()` (URL-safe alphabet, ~10-12 chars — enough entropy to make collisions negligible at this project's scale), inserted with the same SAVEPOINT-retry-on-unique-violation pattern already used by `ChannelsService.createChannel()` for nickname collisions. The UUID stays as the internal primary key; the slug is what appears in public URLs.
- **Pros:** Satisfies "URL curta" directly; reuses an already-proven, tested pattern in the codebase (`.claude/rules/typeorm-queries.md`'s SAVEPOINT retry) rather than inventing a new one; decouples the public identifier from the internal PK, which is generally good practice (internal ID changes/migrations don't leak into URLs).
- **Cons:** One extra unique-indexed column and a small amount of generation/retry logic (already precedented, so low net-new complexity).

### Option C: Sequential/incrementing numeric ID exposed in the URL
- An auto-increment integer column, exposed directly in the video URL.
- **Pros:** Naturally short, trivially unique (DB-enforced), no collision-retry logic needed at all.
- **Cons:** Sequential IDs leak business information (total video count, upload order) and make enumeration/scraping trivial (`/videos/1`, `/videos/2`, ...); breaks the project's UUID-everywhere convention for primary keys, and would require a second sequence just for this purpose since the PK is already a UUID.

**Recommendation:** **Option B (`nanoid` short slug, unique-indexed, SAVEPOINT retry)** — it is the only option that satisfies the explicit "curta" requirement without sacrificing unpredictability (unlike Option C) or reinventing collision handling (it reuses the exact pattern `ChannelsService` already validated for the channel nickname).

**Decision:** Option B

---

## TD-06: Streaming & Download Delivery Strategy

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The architecture diagram already models `frontend → storage: Streams (HTTPS)` as a direct relationship, distinct from `frontend → api: Calls (REST)`. Both playback (streaming, needs HTTP Range/206 support) and download need to serve the video's bytes once its status is `ready`.

**Options:**

### Option A: API-proxied range streaming
- The video controller reads the client's `Range` header, calls `GetObject` on storage with a matching `Range` parameter, and pipes the result back with `206 Partial Content` + `Content-Range`/`Accept-Ranges` headers (e.g., via `StreamableFile`).
- **Pros:** Full control point in the API for every byte served — straightforward place to add per-request authorization checks (useful once Fase 04 introduces public/unlisted visibility).
- **Cons:** Every playback second and every download makes the API a bandwidth pass-through for potentially many concurrent viewers — directly against the diagram's `frontend → storage` direct-streaming relationship, and reintroduces the same "API on the data path" problem TD-02 avoids for uploads, just on the read side.

### Option B: Presigned GET URL, direct-to-storage
- The API's video endpoint returns a short-lived presigned GET URL (e.g., 15 min TTL) for the video object once `status = ready`; the client uses that URL directly against storage. MinIO/S3 natively supports `Range` requests and returns `206 Partial Content` on `GetObject` without any custom code. Download reuses the same presigned-URL mechanism with `ResponseContentDisposition: attachment; filename="..."` set on the presign request.
- **Pros:** Matches the architecture diagram exactly (`frontend → storage: Streams, HTTPS`); zero custom range-parsing code — S3/MinIO's `GetObject` already implements HTTP Range correctly; the API never becomes a bandwidth bottleneck regardless of concurrent viewers; one mechanism (presigned GET) covers both streaming and download, differing only in a response-header parameter.
- **Cons:** Authorization is enforced at presign-time (when the API issues the URL) rather than per-byte-range request — acceptable for Fase 03 (videos are either not-ready or ready-and-owned-by-uploader) but will need revisiting once Fase 04's public/unlisted visibility model exists, since a leaked presigned URL is valid for its full TTL regardless of later visibility changes.

### Option C: Hybrid — presigned URL for streaming, API-proxy for download
- Streaming uses Option B; download uses Option A (API sets `Content-Disposition: attachment` itself while proxying).
- **Pros:** Keeps download fully within the API's control point (e.g., for future download-count tracking or access logging) while still avoiding the API as a bottleneck for the higher-volume streaming path.
- **Cons:** Two different code paths and two different sets of headers/edge cases for what is conceptually "give me the bytes of this video" — added complexity for a benefit (per-download tracking) that is not in this phase's requirements.

**Recommendation:** **Option B (presigned GET URL, direct-to-storage, for both streaming and download)** — it is the literal implementation of the architecture diagram's `frontend → storage` relationship, requires no custom Range-handling code (S3/MinIO already does this correctly), and treats streaming and download as the same underlying mechanism, differing only by a response-header parameter on the presign call — the simplest option that fully satisfies both capability bullets.

**Decision:** Option B

---

## TD-07: Video Status Lifecycle & Processing Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The assignment requires a status cycle of rascunho → processando → pronto/erro, driven by upload initiation and worker outcomes. `docs/project-plan.md` § Pontos de Atenção calls out that processing "deve acontecer em segundo plano, sem bloquear o usuário," implying failures must be visible without blocking anything else. This decision depends on TD-01 (the chosen queue's native retry capabilities directly shape Option A below).

**Options:**

### Option A: Linear status enum + queue-native retry/backoff
- States: `draft → uploaded → processing → ready | failed`. `draft` is set synchronously when the upload is initiated (TD-02's multipart-initiate step, before any bytes arrive); `uploaded` when the multipart upload is confirmed complete; `processing` when the worker picks up the job; `ready`/`failed` set by the worker on completion. Transient failures (e.g., a worker crash mid-job) are retried automatically using the queue's built-in `attempts` + exponential `backoff` job options (e.g., 3 attempts); only after attempts are exhausted does the video move to `failed`. No automatic re-processing after `failed` in this phase.
- **Pros:** Directly matches the assignment's required cycle with no extra states; retry/backoff is free from whichever queue library TD-01 picks (BullMQ, pg-boss, and RabbitMQ-via-Nest all support attempt limits and backoff natively) — no custom retry logic to write or test; failed videos stay queryable/visible to their owner via the existing `status` column, satisfying "sem bloquear o usuário" (the rest of the system is unaffected by one failed job).
- **Cons:** No audit trail of *why* a video failed beyond a single `status = failed` (unless an error-message column is also added, which is a small addition, not a separate architectural choice); no built-in manual-retry endpoint (out of scope for this phase per the deliverables list — re-processing is not a listed capability).

### Option B: Saga/outbox pattern with an events table
- Every transition is recorded as a row in a `video_events` (or similar) audit table, and the queue job is only enqueued via a transactional outbox alongside the draft-row insert, guaranteeing eventual delivery even if the enqueue call itself fails mid-request.
- **Pros:** Full audit trail of every transition; outbox pattern removes the small window where a DB commit succeeds but the enqueue call fails (dual-write problem) — relevant mainly if TD-01 picks a non-transactional queue (BullMQ/RabbitMQ, not pg-boss).
- **Cons:** Meaningfully more implementation surface (an events table, an outbox-relay process or polling mechanism) for a phase whose deliverables list does not ask for audit history or delivery guarantees beyond "processamento automático" working; the dual-write risk it solves is a real but narrow edge case (enqueue failing right after a successful DB commit) that queue-level retry/reconciliation can mitigate more cheaply than a full outbox.

### Option C: State-machine library (e.g., `xstate`) enforcing transitions in code
- Transitions are defined and validated through a formal state-machine library rather than ad-hoc `status` field updates.
- **Pros:** Prevents illegal transitions by construction (e.g., `ready → draft`) and makes the state graph self-documenting in code.
- **Cons:** The state graph here is small and strictly linear (no branches, no parallel states, no re-entrancy) — exactly the case where a state-machine library's guarantees add framework overhead without addressing a real risk; the project has no existing precedent for `xstate` or any state-machine library, and none of the other entities (including the richer Fase 02 token-rotation flow) use one.

**Recommendation:** **Option A (linear enum + queue-native retry/backoff)** — the required lifecycle is small and strictly linear, and every realistic queue choice from TD-01 already provides attempt-limit/backoff semantics for free. Neither the outbox pattern's delivery guarantees nor a state-machine library's transition guarantees address a risk this phase's deliverables actually call for; both are justified additions only if a later phase's requirements demand them.

**Decision:** Option C

---

## TD-08: Thumbnail Frame-Selection Strategy

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** TD-04 fixed *how* the Video Worker invokes FFmpeg (`child_process`, direct FFmpeg/FFprobe calls) but not *which frame* of the video becomes the thumbnail. Grabbing a fixed frame (e.g., frame 0 / the very first moment) is a common source of poor thumbnails — encoder color bars, fade-ins, and black leads are frequent at time zero. The choice also needs to behave sanely for videos of any length, since TD-02's 10GB upload path places no lower bound on duration — a valid upload can be a few seconds long.

**Options:**

### Option A: Fixed timestamp offset
- Extract the frame at a constant offset (e.g., `ffmpeg -ss 1 -i <input> -frames:v 1 <thumbnail>` for 1 second in). Single deterministic `ffmpeg` seek+frame call.
- **Pros:** Simplest possible implementation — one hardcoded argument, trivial to reason about and to assert on in tests.
- **Cons:** Still risks landing on an intro fade/black frame for videos whose first second is a lead-in; requires an explicit fallback branch for videos shorter than the offset (using the duration already extracted by TD-04's `ffprobe` metadata step), which reintroduces the same offset-tuning problem at a smaller scale.

### Option B: Percentage-of-duration offset
- Compute the seek point as a percentage of the video's total duration (e.g., 10%), using the `duration` value TD-04's `ffprobe` metadata step already extracts before the thumbnail step runs: `ffmpeg -ss <duration * 0.10> -i <input> -frames:v 1 <thumbnail>`.
- **Pros:** Scales to any video length by construction — a 3-second clip and a 3-hour video both get a proportionally-placed frame with the exact same formula; no separate fallback branch needed, since the computed offset is always `< duration` whenever `duration > 0` (already guaranteed by the metadata step that runs first). Still a single deterministic seek+frame `ffmpeg` call, same cost profile as Option A.
- **Cons:** One small arithmetic step (multiply duration by the chosen percentage) before building the `ffmpeg` command, versus a hardcoded constant in Option A.

### Option C: FFmpeg content-aware `thumbnail` filter
- Use FFmpeg's built-in `thumbnail` video filter (`ffmpeg -i <input> -vf "thumbnail=N" -frames:v 1 <thumbnail>`), which analyzes a batch of `N` frames and picks the one it scores as most "representative" (a scene-complexity heuristic purpose-built for thumbnail extraction).
- **Pros:** Purpose-built for exactly this problem — actively avoids black/blank/fade frames algorithmically instead of relying on a fixed or proportional offset guess; result is still deterministic for a given input file.
- **Cons:** Must decode and analyze a window of `N` frames instead of a single seek, meaningfully heavier per invocation than Options A/B; adds a filter-graph argument to reason about (`thumbnail=N`) instead of a plain seek, for a capability bullet that only asks for "a frame," not a quality-optimized one.

**Recommendation:** **Option B (percentage-of-duration offset)** — it is the only option that fully satisfies "a frame from the video" for arbitrary durations (a real concern given TD-02 places no floor on upload length) without a special-case fallback branch, while staying exactly as cheap as Option A (one seek, one frame). Option C's content-aware selection is a genuine quality upgrade but analyzes multiple frames for a requirement the capability bullet does not ask for ("a frame," not "the best frame") — the same reasoning TD-07 already applied to reject the outbox/state-machine options: a refinement worth revisiting only if plain offset-based thumbnails prove insufficient in practice.

**Decision:** Option B

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | BullMQ + Redis | A |
| TD-02 | Backend | Large File (10GB) Upload Strategy | Direct-to-storage multipart + presigned URLs | A |
| TD-03 | Backend | Object Storage Key/Bucket Organization | Single bucket, hierarchical keys, `@aws-sdk/client-s3` | A |
| TD-04 | Backend | Video Worker Execution & Processing | Separate NestJS standalone app + `child_process` FFmpeg/FFprobe | A |
| TD-05 | Backend | Unique Video URL / Public Identifier | `nanoid` short slug, unique-indexed, SAVEPOINT retry | B |
| TD-06 | Backend | Streaming & Download Delivery Strategy | Presigned GET URL, direct-to-storage | B
| TD-07 | Backend | Video Status Lifecycle & Failure Handling | Linear enum + queue-native retry/backoff | C |
| TD-08 | Backend | Thumbnail Frame-Selection Strategy | Percentage-of-duration offset | B |

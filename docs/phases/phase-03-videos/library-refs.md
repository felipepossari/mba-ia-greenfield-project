---
kind: phase
name: phase-03-videos
artifact: library-refs
sources:
  - docs/decisions/technical-decisions-phase-03-videos.md
  - docs/phases/phase-03-videos/phase-03-videos.md
---

# Library References — Phase 03: Upload e Processamento de Vídeos

This document pins the exact versions and configuration for all new libraries introduced in Phase 03.

## New Libraries

### Message Queue (TD-01)

| Library | Version | Decision | Notes |
|---------|---------|----------|-------|
| `bullmq` | `^5.10.0` | TD-01: BullMQ + Redis for video processing job queue | Job queue library for Redis-backed async processing; supports retry with exponential backoff, stalled-job recovery, and concurrency limits |
| `ioredis` | `^5.3.0` | TD-01: Redis client for BullMQ | Async Redis client; BullMQ depends on it for connection pooling and pub/sub |
| `@nestjs/bullmq` | `^10.1.0` | NestJS official integration for BullMQ | Provides `BullModule.registerQueue()` decorators, `@Processor()`, `@Worker()` pattern matching NestJS conventions |

**Registration:**
- `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: ... })` in `AppModule`
- `queueConfig` reads `REDIS_HOST`, `REDIS_PORT` from env
- Docker Compose service: `redis:7-alpine` on port `6379`

---

### Object Storage (TD-02, TD-03)

| Library | Version | Decision | Notes |
|---------|---------|----------|-------|
| `@aws-sdk/client-s3` | `^3.500.0` | TD-03: S3-compatible object storage client | Vendor-neutral AWS SDK v3; works unmodified against MinIO (dev) and AWS S3 (prod) |
| `@aws-sdk/s3-request-presigner` | `^3.500.0` | TD-02, TD-06: Presigned URL generation | Handles multipart upload presign (PUT parts), and GET presign for streaming/download with Range and Content-Disposition support |

**Configuration:**
- `storageConfig` reads `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` from env
- Docker Compose service: `minio/minio:latest` (S3-compatible) on ports `9000` (API), `9001` (console)
- Key layout: `videos/{channelId}/{videoId}/original` (video) and `videos/{channelId}/{videoId}/thumbnail.jpg` (thumbnail)

---

### Video Processing (TD-04)

**No new npm packages.** FFmpeg and FFprobe are invoked via Node's built-in `child_process.execFile` (not via the archived `fluent-ffmpeg` library).

- **FFprobe:** extract duration and metadata (invoked in worker)
- **FFmpeg:** extract thumbnail frame at a percentage-of-duration offset (invoked in worker)
- Both are system binaries; must be available in the worker container

**Worker Docker image:** extends the existing `nestjs-project` image (which includes `ffmpeg` and `ffprobe` as dev dependencies)

---

## Environment Variables

### Development (in `docker-compose.yml`)

```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"

minio:
  image: minio/minio:latest
  environment:
    - MINIO_ROOT_USER=minioadmin
    - MINIO_ROOT_PASSWORD=minioadmin
  ports:
    - "9000:9000"
    - "9001:9001"
```

### Application (in `.env`)

```dotenv
REDIS_HOST=redis
REDIS_PORT=6379

S3_ENDPOINT=http://minio:9000
S3_BUCKET=streamtube
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
```

---

## Breaking Changes

- None. Phase 03 introduces new infrastructure (Redis, MinIO) and new libraries, but does not modify existing APIs or dependencies from Phase 02.

---

## Migration Path (if switching libraries later)

### Queue Alternatives
- **pg-boss:** If opting out of Redis, pg-boss provides DB-backed queue on existing PostgreSQL (see TD-01 Option B). Minimal code changes — most of the `@Processor` / job-handler code remains the same.
- **RabbitMQ:** If message-routing complexity grows, RabbitMQ is a drop-in via `@nestjs/microservices` RabbitMQ transport (see TD-01 Option C). Requires changing producer/consumer APIs.

### Storage Alternatives
- **AWS S3:** Direct swap — `S3_ENDPOINT` points to `s3.amazonaws.com`, credentials to IAM user, bucket to real AWS. SDK code unchanged.
- **Other S3-compatible:** (DigitalOcean Spaces, Backblaze B2, etc.) — set `S3_ENDPOINT` to their endpoint. SDK code unchanged.
- **Non-S3 storage:** GCS (Google Cloud Storage), Azure Blob Storage, etc. would require swapping `@aws-sdk/client-s3` for their SDKs. Moderate refactor of `StorageService`.

---

## Verification

After installing new libraries, verify:

1. `npm install` completes without warnings
2. `docker compose build` succeeds (includes ffmpeg/ffprobe)
3. `docker compose up` brings up `redis`, `minio`, and worker without errors
4. `npm test` and `npm run test:e2e` pass (integration and e2e tests exercise the real infra)
5. MinIO console accessible at `http://localhost:9001` (minioadmin / minioadmin)
6. Redis reachable at `localhost:6379` (test with `redis-cli ping` from host)

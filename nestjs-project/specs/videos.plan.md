---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5, SI-03.6, SI-03.7, SI-03.12, SI-03.13
target_file: test/videos.e2e-spec.ts
---

# /videos Test Plan

## Application Overview

The `/videos` resource covers the full video ingestion lifecycle exposed by `VideosController`: an owner-only flow to initiate a multipart upload (`POST /videos`), complete it and trigger background processing (`POST /videos/:publicId/complete-upload`), poll status (`GET /videos/:publicId`), and — once the worker has transitioned the video to `'ready'` — two anonymous delivery endpoints for streaming (`GET /videos/:publicId/stream`) and download (`GET /videos/:publicId/download`). Owner-scoped endpoints return `404 VIDEO_NOT_FOUND` rather than `403` for videos the caller doesn't own, to avoid leaking existence.

## Test Scenarios

### 1. POST /videos (Initiate Upload)

**Setup:** `beforeEach` truncate test DB; bootstrap `AppModule` via `Test.createTestingModule(...).compile()`; seed an authenticated user + owned channel and obtain a valid access token via the auth flow

#### 1.1. initiate-upload-with-valid-body-returns-201

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. POST /videos com body válido (`filename`, `fileSizeBytes`, `mimeType`) e `Authorization: Bearer <access_token>` válido
    - expect: resposta `201`
    - expect: body contém `id`, `publicId`, `status: "draft"`, `uploadId`, `storageKey`, `partSizeBytes`, e `parts` (array de `{ partNumber, url }`)

#### 1.2. initiate-upload-exceeding-max-file-size-returns-400

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. POST /videos com `fileSizeBytes` maior que 10GB e token válido
    - expect: resposta `400` com `errorCode: "VALIDATION_ERROR"`

#### 1.3. initiate-upload-without-access-token-returns-401

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. POST /videos com body válido, sem header `Authorization`
    - expect: resposta `401`

---

### 2. POST /videos/:publicId/complete-upload

**Setup:** `beforeEach` truncate test DB; bootstrap `AppModule`; seed an owned draft `Video` (via the initiate-upload flow) with a matching in-progress multipart upload on the storage backend

#### 2.1. complete-upload-with-matching-parts-transitions-to-processing

**Covers AC:** #1, #4
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. POST /videos/:publicId/complete-upload com `parts` que casam com o que o storage registrou para o upload, e token válido do owner
    - expect: resposta `200` com `{ publicId, status: "processing" }`
    - expect: exatamente um job `video.processing` é enfileirado carregando `videoId`, `storageKey`, `publicId`

#### 2.2. complete-upload-on-already-completed-video-returns-409

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. POST /videos/:publicId/complete-upload em um vídeo cujo `status` já passou de `'draft'`
    - expect: resposta `409` com `errorCode: "UPLOAD_ALREADY_COMPLETED"`

#### 2.3. complete-upload-on-unowned-or-unknown-video-returns-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. POST /videos/:publicId/complete-upload com um `publicId` inexistente
    - expect: resposta `404` com `errorCode: "VIDEO_NOT_FOUND"`
  2. POST /videos/:publicId/complete-upload com um `publicId` existente mas de outro owner
    - expect: resposta `404` com `errorCode: "VIDEO_NOT_FOUND"`

---

### 3. GET /videos/:publicId (Status)

**Setup:** `beforeEach` truncate test DB; bootstrap `AppModule`; seed an owned `Video` row in a known status

#### 3.1. get-status-for-owned-video-returns-200

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId com token válido do owner
    - expect: resposta `200` com `publicId`, `status`, `durationSeconds`, `failureReason`, `createdAt`

#### 3.2. get-status-for-unowned-or-unknown-video-returns-404

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId com um `publicId` inexistente
    - expect: resposta `404` com `errorCode: "VIDEO_NOT_FOUND"`
  2. GET /videos/:publicId com um `publicId` existente mas de outro owner
    - expect: resposta `404` com `errorCode: "VIDEO_NOT_FOUND"`

---

### 4. GET /videos/:publicId/stream

**Setup:** `beforeEach` truncate test DB; bootstrap `AppModule`; seed `Video` rows in `'ready'` and non-`'ready'` statuses

#### 4.1. stream-ready-video-returns-200-without-auth

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId/stream de um vídeo `status: 'ready'`, sem header `Authorization`
    - expect: resposta `200` com `url` presigned e `expiresAt`

#### 4.2. stream-video-not-ready-returns-409

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId/stream de um vídeo cujo `status` não é `'ready'`
    - expect: resposta `409` com `errorCode: "VIDEO_NOT_READY"`

#### 4.3. stream-unknown-video-returns-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId/stream com um `publicId` inexistente
    - expect: resposta `404` com `errorCode: "VIDEO_NOT_FOUND"`

---

### 5. GET /videos/:publicId/download

**Setup:** `beforeEach` truncate test DB; bootstrap `AppModule`; seed `Video` rows in `'ready'` and non-`'ready'` statuses

#### 5.1. download-ready-video-returns-200-with-attachment-disposition

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId/download de um vídeo `status: 'ready'`, sem header `Authorization`
    - expect: resposta `200` com `url` presigned carregando `Content-Disposition: attachment` e `expiresAt`

#### 5.2. download-video-not-ready-returns-409

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId/download de um vídeo cujo `status` não é `'ready'`
    - expect: resposta `409` com `errorCode: "VIDEO_NOT_READY"`

#### 5.3. download-unknown-video-returns-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-08-12T23:13:12Z

**Steps:**
  1. GET /videos/:publicId/download com um `publicId` inexistente
    - expect: resposta `404` com `errorCode: "VIDEO_NOT_FOUND"`

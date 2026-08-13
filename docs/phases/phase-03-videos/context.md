---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-12T18:41:30-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-08-06T08:05:15-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-08-06T08:05:15-03:00"
  docs/phases/phase-02-auth/context.md: "2026-08-06T08:05:15-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-08-06T08:05:15-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-08-06T08:05:15-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos
**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.
**Affected subprojects:** no explicit subproject paths mentioned in this phase's text (implicit: `nestjs-project/` — backend-only phase per decisions doc scope note).
**Deferred subprojects:** _None._
**Sequencing notes:** Depende de: Fase 01, Fase 02

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A | — |
| phase-03-videos/TD-02 | phase | Backend | Large File (10GB) Upload Strategy | decided | A | — |
| phase-03-videos/TD-03 | phase | Backend | Object Storage Key/Bucket Organization | decided | A | — |
| phase-03-videos/TD-04 | phase | Backend | Video Worker Execution & Processing (Metadata + Thumbnail) | decided | A | — |
| phase-03-videos/TD-05 | phase | Backend | Unique Video URL / Public Identifier | decided | B | — |
| phase-03-videos/TD-06 | phase | Backend | Streaming & Download Delivery Strategy | decided | B | — |
| phase-03-videos/TD-07 | phase | Backend | Video Status Lifecycle & Processing Failure Handling | decided | C | — |
| phase-03-videos/TD-08 | phase | Backend | Thumbnail Frame-Selection Strategy | decided | B | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04, phase-03-videos/TD-08 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** video processing jobs are long-running, resource-heavy, and failure-prone (corrupt uploads, unsupported codecs, worker crashes mid-transcode), which is exactly BullMQ's strength: built-in retry/backoff, stalled-job recovery, and concurrency limits without custom code. It is also the most unambiguous way to satisfy the phase's explicit requirement that a real, distinct queue is running in Compose — pg-boss's "queue" would be invisible as a container, which is a weaker demonstration of the architecture even though it is a legitimate and lower-footprint choice. Redis is a small, well-understood addition to the Compose stack.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** it is the only option that keeps the API fully off the data path for the actual bytes, which is what "sem impacto na performance" requires at 10GB scale, and it reuses the same `@aws-sdk/client-s3` dependency needed for TD-03/TD-06 rather than introducing a dedicated upload server. Part-level retry covers the "retomar em caso de falha" requirement adequately for this phase's scope; true byte-level resume (Option C) is a refinement that can be revisited later if part-level granularity proves insufficient.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** vendor neutrality is the deciding factor: the project's own architecture diagram treats S3 and MinIO as interchangeable, and `@aws-sdk/client-s3` is what makes that interchangeability real in code. A single bucket with hierarchical keys is the simplest layout that still cleanly separates videos and thumbnails per channel/video, appropriate for this project's scale.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** it is the only option that both matches the diagram's "Video Worker" as a genuinely separate deployable and stays idiomatic with the rest of the (100% NestJS) codebase. Direct `child_process` calls to FFmpeg/FFprobe are chosen over `fluent-ffmpeg` specifically because that library is archived and known to misbehave with current FFmpeg — a dependency that would be inherited as unmaintained on day one.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** it is the only option that satisfies the explicit "curta" requirement without sacrificing unpredictability (unlike Option C) or reinventing collision handling (it reuses the exact pattern `ChannelsService` already validated for the channel nickname).
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** it is the literal implementation of the architecture diagram's `frontend → storage` relationship, requires no custom Range-handling code (S3/MinIO already does this correctly), and treats streaming and download as the same underlying mechanism, differing only by a response-header parameter on the presign call — the simplest option that fully satisfies both capability bullets.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** the required lifecycle is small and strictly linear, and every realistic queue choice from TD-01 already provides attempt-limit/backoff semantics for free. Neither the outbox pattern's delivery guarantees nor a state-machine library's transition guarantees address a risk this phase's deliverables actually call for; both are justified additions only if a later phase's requirements demand them.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** it is the only option that fully satisfies "a frame from the video" for arbitrary durations (a real concern given TD-02 places no floor on upload length) without a special-case fallback branch, while staying exactly as cheap as Option A (one seek, one frame). Option C's content-aware selection is a genuine quality upgrade but analyzes multiple frames for a requirement the capability bullet does not ask for ("a frame," not "the best frame") — the same reasoning TD-07 already applied to reject the outbox/state-machine options: a refinement worth revisiting only if plain offset-based thumbnails prove insufficient in practice.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** @nestjs/config — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** @nestjs/config@^4.x

### phase-01-configuracao-base/TD-02

**Recommendation:** Joi — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** joi@^17.x

### phase-01-configuracao-base/TD-03

**Recommendation:** Namespaced/grouped with registerAs — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Shared registerAs factory — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** dotenv (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** argon2@^0.41.x

### phase-02-auth/TD-02

**Recommendation:** @nestjs/passport — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** @nestjs/jwt@^11.0.0

### phase-02-auth/TD-03

**Recommendation:** Refresh Token Rotation — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Random Opaque Tokens in DB — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** @nestjs-modules/mailer — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** @nestjs-modules/mailer@^2.x, handlebars@^4.x

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** class-validator@^0.14.x, class-transformer@^0.5.x

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** @nestjs/throttler@^6.x

### phase-02-auth/TD-09

**Recommendation:** Opaque — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** @nestjs/jwt@^11.0.0

### phase-02-auth/TD-10

**Recommendation:** The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) Architectural fit — the strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) Smaller blast radius — a ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) Compatibility with Next.js 16 / React 19 — built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) Defense in depth on the cookie content — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection. (2) Single cookie to manage simplifies logout and avoids the orphan-cookie failure mode of Option A. (3) Room to carry minimal user metadata (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome without a per-render `/auth/me` round-trip. Option A is a viable downgrade; the migration is a one-Route-Handler refactor. Option C is rejected as solving a problem the project does not have.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) Decoupled from TD-05 — works with Route Handlers OR Server Actions. (2) Aligned with shadcn's canonical form primitive — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers. (3) Zod-first developer ergonomics match the rest of the FE foundation — `next-frontend-config-base/TD-01` chose Zod 4 for env. Option B is rejected for impedance with shadcn's primitive; Option C is rejected for per-field boilerplate.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) Strict-BFF alignment — `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) Test scaffold already exists — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions. (3) Single mutation surface — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking. Option B fragments the BFF surface; migration A→B is per-form if ever needed.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) No first-render flicker, no round-trip — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state. (2) No new BFF endpoint — the cookie is the source of truth, RSC reads it, the Provider broadcasts it. The `router.refresh()` requirement after mid-session mutations is a small price. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) First-paint-correct — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) Single integration pattern across both flows — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused). (3) Email-prefetch behavior is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** it is the only option that preserves the prior decisions (`class-validator` in phase-02-auth/TD-06) without a re-platform; the CLI plugin with `classValidatorShim: true` leverages the existing `class-validator` decorators to infer schemas, keeping boilerplate low. Nestia has real technical merit but the validation-stack migration cost makes it unviable without an upstream decision to supersede TD-06. Manual authoring is discarded.
**Libraries:** @nestjs/swagger
**Revisions:**

- 2026-05-12 — Clarifies that the CLI plugin (`classValidatorShim: true`) only covers DTO schema inference from `class-validator`; documenting operations, per-status-code typed responses, error contracts (aligned with phase-02-auth/TD-07's envelope) and examples require explicit decorators (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). Rationale: enrichment via explicit decorators is part of the chosen Option A, not out-of-scope work.

### openapi-docs-nestjs/TD-02

**Recommendation:** the marginal cost over Option A is just one npm script (~15 lines) and the benefit is a correct foundation for future FE integration (offline codegen) without losing the interactive UI dev/QA use. Option B alone hurts local dev experience; Option A alone compromises the future codegen pipeline. Combining is dominant.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** aligns with the defensive posture already established in phase 02 and doesn't compromise legitimate consumers (the `openapi.json` committed in TD-02 serves as "spec consultable outside the UI"). Reopening as Option A or C is trivial in the future if a public API use case appears.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Three converging reasons: (1) Type-inference matches the FE's strict-TS culture — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) Ecosystem gravity in Next.js / React 19 — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) Direct enablement of TD-02 (`@t3-oss/env-nextjs`) — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** the only option that combines (i) type-level NEXT_PUBLIC_ prefix enforcement, (ii) runtime Proxy-based leak detection, and (iii) single-file, single-import-path consumer ergonomics. Option B reaches roughly the same structural outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** Three reasons. (1) MSW's own best-practice recommends it — the project should not invent its own scheme when the official one is documented and matches the codebase's domain orientation. (2) Domain ownership tracks the codebase, not the project plan — `components/`, `app/api/`, and any future feature folders will be organized by domain (auth, videos, channels), so handler files mirror that vocabulary and remain stable as phases come and go. (3) Append-only growth with minimal merge conflicts — each phase touches a new file plus one line in the barrel, which is the smallest practical concurrent-PR footprint.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** the browser worker is a future capability with no documented current consumer; wiring it now is speculative investment, and wiring it incoherently would actively mislead developers into thinking interception works when it doesn't under strict BFF. Option A keeps the foundation minimal, aligns 1:1 with everything CLAUDE.md and the existing rules currently document, and is non-breaking to extend.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** Reasons: (1) hand-written determinism + readability is the right baseline — every fixture in Phase 02 (5–7 endpoints, single-record-mostly) is naturally hand-written, and the diff-revealing override pattern is the highest-value benefit. (2) Bulk-collection cases will arrive (Phase 07 home page grid, Phase 06 comment threads) and inline hand-written lists of 20+ items are genuinely tedious — keeping faker available as a scoped tool is pragmatic. (3) Per-fixture local seeding eliminates the global-cursor pitfall that makes seeded-faker-as-default structurally fragile.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** the user's "import only what it needs" requirement is satisfied at the authoring layer by TD-01 (per-domain files; each phase adds one file). At the runtime layer, loading all handlers is the canonical MSW v2 model and imposes no cost on tests that don't fetch the extra URLs. `onUnhandledRequest: "error"` enforces that a phase's test cannot accidentally invoke a route outside its scope, which is the strongest version of "stays inside its phase" available.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Three reinforcing reasons. (1) Strict BFF makes the SDK surface valueless on the client — only Route Handlers ever call the upstream Nest; they already use `fetch`; a generated SDK adds a third client style to learn for zero functional gain. (2) Types-first matches the rest of the FE foundation — env validation is Zod-derived types; component variants are `cva` types; both are TS-first with zero generated runtime. (3) MSW typing is solved by the same `paths` symbol. The marginal cost of adding `openapi-fetch` (~6KB, server-side only) is small enough that the types + thin-client pair is recommended, not types alone.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** Three reasons. (1) Preserves the compose-stack independence that `next-frontend-config-base/TD-03` calls out as the current architecture — neither subproject's compose file references the other. (2) Drift is eliminated structurally when paired with TD-03's CI freshness check. (3) The committed local file is a real artifact in PR review — reviewers see the contract change in `next-frontend/openapi.json`'s diff at the same time as the backend change.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** it is the only option that makes contract drift both visible (in PR diffs) and impossible to merge accidentally (CI fail). The complexity premium over the non-CI option is one CI step. Downgrading later is reversible (just remove the CI step) but upgrading later requires explaining generated-file history in a separate commit — start with the check in place.
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** it is the only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths. The "long file" concern is bounded — for the scope of StreamTube, the BFF will likely have <30 contract aliases at peak.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Reasons: (1) Determinism over auto-generation — BFF integration tests assert on specific values; randomized fixtures are anti-helpful. (2) Coherence with TD-01's recommendation — `openapi-typescript`'s `paths` type is the single contract anchor; reusing it in MSW handlers means "spec ↔ handler ↔ assertion" is one type chain. (3) Scale fit — Phase 02 introduces few endpoints; the manual cost is negligible at this stage.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({...})` _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)` _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]` _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase (BE-side generic entry); UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact created | Required tests | Guide |
|---|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` | `artifacts/entities.md` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract | `artifacts/services.md` |
| Service with DB only (no branching) | Integration: DB contract | `artifacts/services.md` |
| Service with configured lib (JWT, cache) | Unit: real lib with test config | `artifacts/services.md` |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter | `artifacts/services.md` |
| Module with configured imports | Unit: compilation test | `artifacts/modules.md` |
| Controller | E2E only — do NOT write unit tests | `artifacts/controllers.md` |
| DTO | E2E: one validation wiring test per endpoint | `artifacts/dtos.md` |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic | `artifacts/guards.md` |
| Guard (simple, delegates to Passport) | E2E only | `artifacts/guards.md` |
| Strategy (Passport) | E2E via guard | `artifacts/strategies.md` |
| Pipe (custom transformation/validation) | Unit | `artifacts/pipes.md` |
| Interceptor (response transform, logging) | Unit and/or E2E | `artifacts/interceptors.md` |
| Exception Filter | Unit + E2E | `artifacts/filters.md` |
| Middleware | E2E | `artifacts/middleware.md` |

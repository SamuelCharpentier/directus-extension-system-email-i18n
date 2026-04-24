# Directus Generic Email i18n Extension Plan

> Purpose: define a reusable, publishable Directus extension for multilingual transactional emails, fully decoupled from Sympo business workflows.

## 1. Product Definition

### 1.1 Name (working)

- Package name: `directus-extension-email-i18n-core`
- Scope: generic email template storage, sync, rendering, system-email override, and send logging

### 1.2 Goals

- Provide multilingual templates for Directus system emails (password reset, invitation, registration/verification)
- Support generic business emails without embedding any domain-specific workflow logic
- Keep database as source of truth for templates
- Keep filesystem templates as rendering cache compatible with Directus Liquid rendering
- Auto-bootstrap required collections and fields when extension loads
- Be safe to publish as a standalone extension

### 1.3 Non-goals

- No domaon-specific template keys, variables, or status transitions
- No hardcoded domain rules
- No front-end admin implementation inside the extension
- No queue engine included (can integrate with external queue later)

---

## 2. Architecture Split

### 2.1 Layer A: Generic Core Extension (publishable)

Responsibilities:

- Schema bootstrap at startup (create/update required collections)
- Manage template definitions and language variants
- Sync DB template records to Liquid files
- Integrity check (DB record vs filesystem cache) before send
- Intercept and localize Directus system emails
- Expose a generic send service callable from other extensions or API code
- Log all sends in a generic email logs collection

### 2.2 Layer B: Business Integration (project-specific)

Responsibilities:

- Register business template keys and variable resolvers
- Trigger sends based on business events and state machine transitions
- Build domain payloads for variables
- Own campaign filtering and recipient segmentation logic

### 2.3 Layer C: Frontend Admin UI (project-specific)

Responsibilities:

- Template editing screens
- Campaign send UI
- Email logs and resend UI
- Business-specific preview data and guardrails

The UI should consume API endpoints from Layer B, while Layer B uses Layer A service APIs.

---

## 3. Generic Core Data Model (Bootstrap on Load)

## 3.1 Collections

1. `email_templates`
2. `email_template_variables`
3. `email_logs`
4. `email_template_sync_audit` (optional but recommended)

## 3.2 email_templates (generic)

Required fields:

- `id` (uuid)
- `template_key` (string)
- `language` (string, ISO short code, example: fr, en)
- `category` (enum: system, transactional, marketing, custom)
- `subject` (string)
- `body` (text, Liquid)
- `description` (text, nullable)
- `is_active` (boolean)
- `version` (integer)
- `checksum` (string)
- `last_synced_at` (datetime, nullable)
- `created_at`, `updated_at` (timestamps)

Constraints:

- Unique composite: (`template_key`, `language`)
- Index: (`category`, `is_active`)

## 3.3 email_template_variables (generic registry)

Required fields:

- `id` (uuid)
- `template_key` (string)
- `variable_name` (string)
- `is_required` (boolean)
- `description` (text)
- `example_value` (string/text)

Constraints:

- Unique composite: (`template_key`, `variable_name`)

## 3.4 email_logs

Required fields:

- `id` (uuid)
- `template_id` (fk nullable for ad hoc send)
- `template_key` (string)
- `language` (string)
- `recipient_email` (string)
- `recipient_name` (string nullable)
- `subject_rendered` (string)
- `body_rendered` (text)
- `variables_used` (json)
- `status` (enum: pending, sent, failed, bounced)
- `error_message` (text nullable)
- `provider_message_id` (string nullable)
- `sent_at` (datetime nullable)
- `created_at` (datetime)

Recommended index:

- (`template_key`, `status`, `created_at`)

## 3.5 email_template_sync_audit (optional)

Tracks mismatch/re-sync events:

- `template_key`, `language`, `reason`, `action`, `created_at`

---

## 4. Startup Bootstrap Strategy

### 4.1 Boot lifecycle

On extension init:

1. Acquire a bootstrap lock (to avoid concurrent schema writes)
2. Check collection existence
3. Create missing collections and required fields
4. Create required indexes and constraints
5. Seed only system email starter templates (FR + EN)
6. Register extension health flag (boot success/failure)

### 4.2 Idempotency

- Bootstrap must be repeatable and safe on every startup
- Never overwrite admin-edited template content during seed
- Use upsert by (`template_key`, `language`) only when record missing

### 4.3 Failure mode

- If bootstrap fails, extension should log structured fatal error and mark itself degraded
- Optional strict mode: block sends when schema is incomplete

---

## 5. Template Filesystem Sync

### 5.1 Naming

- Default language file: `templates/{template_key}.liquid`
- Other language file: `templates/{template_key}.{language}.liquid`

### 5.2 Sync triggers

- On create/update of `email_templates`
- On send if integrity check fails
- Optional manual resync endpoint/operation

### 5.3 Content wrapper

Write files with layout wrapper:

- `{% layout 'base' %}`
- `{% block content %} ... {% endblock %}`

Layout name should be configurable in extension options.

---

## 6. System Email Coverage (Starter Templates)

Seed these template keys only:

- `password-reset`
- `user-invitation`
- `user-registration`

For each key seed:

- FR subject/body starter text
- EN subject/body starter text
- Variable registry entries

Default variable contracts:

- `password-reset`: `reset_url`, `project_name`, `expiry_hours`
- `user-invitation`: `invite_url`, `project_name`
- `user-registration`: `verify_url`, `project_name`

No business templates are seeded by the core extension.

---

## 7. Generic Send Service API

Expose internal service method signature (for other extensions):

- `sendTemplate({ templateKey, language?, to, variables, metadata? })`

Behavior:

1. Resolve language with fallback chain
2. Validate required variables against registry
3. Integrity check and auto-resync if needed
4. Render subject + body
5. Send using Directus MailService
6. Persist `email_logs` row
7. Return structured result (`sent`, `logId`, `providerMessageId`)

Language fallback chain:

1. Explicit language argument
2. Recipient user language resolver callback (optional plug-in)
3. Extension default language (config)

---

## 8. Configuration Surface (Core Extension)

Suggested options:

- `defaultLanguage` (fr)
- `supportedLanguages` (fr,en)
- `templateDirectory` (templates)
- `baseLayoutName` (base)
- `integrityLengthTolerancePct` (10)
- `strictBootstrap` (false)
- `enableSyncAudit` (true)
- `enableSystemEmailOverride` (true)

---

## 9. Business Integration Contract

Business layer must provide:

- Template key registry for domain templates
- Variable resolver functions per template key
- Trigger handlers for business events
- Optional recipient resolver

Recommended interface:

- `registerBusinessTemplate({ key, variablesSchema })`
- `sendBusinessEmail({ key, context })`

Core extension never imports business tables directly.

---

## 10. Frontend UI Separation

### 10.1 Generic UI package (optional future product)

Potential separate package later:

- Template CRUD and preview for any Directus project
- Variable schema viewer
- Sync status and health view
- Send logs viewer

### 10.2 Sympo UI (current project)

Stays in SvelteKit app and adds:

- Campaign targeting by Sympo domain filters
- Domain-specific sample payload previews
- Business approval and resend flows

---

## 11. Security and Permissions

- Only admin role can modify templates and variables schema by default
- Service-account policy for automated sends
- Redact sensitive variables in logs when marked secret
- Prevent unsafe Liquid constructs if policy requires restricted rendering

---

## 12. Observability

Structured logs with event names:

- `email.bootstrap.started|completed|failed`
- `email.sync.performed`
- `email.integrity.mismatch`
- `email.send.succeeded|failed`

Metrics to expose:

- send success rate
- mismatch rate
- average render/send latency

---

## 13. Testing Strategy for Publishable Core

1. Unit tests

- language fallback
- variable validation
- checksum and integrity logic
- bootstrap idempotency

2. Integration tests

- schema bootstrap in clean Directus instance
- system email override end-to-end
- template update then send auto-resync
- log persistence on success and failure

3. Contract tests

- business layer calls into core send API

---

## 14. Packaging and Release Plan

### 14.1 Repository strategy

- Separate repository for core extension
- CI with lint, test, build, package
- Semantic versioning

### 14.2 Versioning policy

- Major: schema or API breaking change
- Minor: new optional features, new config options
- Patch: fixes and non-breaking internal improvements

### 14.3 Publish targets

- npm package
- Directus marketplace listing (if eligible)
- release notes with migration guide

---

## 15. Migration Plan from Current Sympo Plan

1. Extract all generic logic from current email system plan into core extension scope
2. Keep Sympo business templates in project seed scripts, not core bootstrap
3. Move business trigger logic to SvelteKit/Directus project-specific module
4. Keep admin pages in SvelteKit as business layer concern
5. Integrate by calling core `sendTemplate` service from business endpoints

---

## 16. Implementation Roadmap (Core First)

Phase 1: Core foundation

- bootstrap schema
- system template seed
- send pipeline
- logging

Phase 2: Hardening

- integrity checks + audit
- config surface
- tests
- docs

Phase 3: Publish

- package metadata and examples
- migration notes
- release 1.0.0

Phase 4: Sympo integration

- add Sympo business template seeds in project repo
- wire Sympo event triggers
- update SvelteKit admin screens to consume split architecture

---

## 17. Immediate Next Deliverables

1. Technical spec for bootstrap DDL behavior and Directus SDK calls
2. TypeScript interfaces for core send service and business plug-in contract
3. Minimal seed content files for the 3 system templates in FR/EN
4. Proof-of-concept extension skeleton in `Directus/extensions/directus-extension-email-i18n-core`

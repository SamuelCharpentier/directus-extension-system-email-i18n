# Email System Plan

> Companion document to [2-BUSINESS_LOGIC.md](2-BUSINESS_LOGIC.md) §2.11 and [4-DB_SCHEMA.md](4-DB_SCHEMA.md) §9.
> This document covers the Directus extension architecture, template design, sync mechanism, sending workflows, and logging.

## Table of Contents

1. [Overview](#1-overview)
2. [Extension Architecture](#2-extension-architecture)
3. [DB → Filesystem Sync](#3-db--filesystem-sync)
4. [Integrity Checks](#4-integrity-checks)
5. [Template Design](#5-template-design)
6. [System Email Templates](#6-system-email-templates)
7. [Business Email Templates](#7-business-email-templates)
8. [Sending Targets & Workflows](#8-sending-targets--workflows)
9. [Email Signature](#9-email-signature)
10. [Logging & Auditing](#10-logging--auditing)
11. [SvelteKit Admin UI](#11-sveltekit-admin-ui)
12. [Template Variables Reference](#12-template-variables-reference)

---

## 1. Overview

All platform emails — both system (password reset, user invitation, user registration) and business (registration confirmation, selection notifications, payment receipts, campaigns) — are managed through a single custom Directus hook extension.

**Key principles:**

- **Database is the source of truth.** Templates are stored in the `email_templates` collection and edited via a SvelteKit admin UI.
- **Filesystem is a rendering cache.** The extension syncs DB templates to `.liquid` files so Directus can render them with its built-in Liquid engine.
- **Integrity is verified on every send.** Modified date and content length are compared; mismatches trigger a re-sync + warning log.
- **All emails are logged.** Every outbound email is recorded in `email_logs` for auditing, debugging, and resend capability.

---

## 2. Extension Architecture

### 2.1 Extension Type

- **Type:** Directus Hook Extension (single combined extension)
- **Name:** `directus-extension-email-system` (replaces current `directus-extension-system-email-i18n`)
- **Hooks registered:** `email.send` (before), `items.create` / `items.update` on `email_templates`

### 2.2 Responsibilities

| Responsibility                  | Hook / Trigger                       | Description                                                              |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| **System email i18n override**  | `email.send` (filter)                | Intercepts system emails, resolves user language, loads correct template |
| **Business email sending**      | Called by SvelteKit API routes       | Renders template with variables, sends via Directus mail service, logs   |
| **Template sync to filesystem** | `items.create`/`update` on templates | On template save, writes `.liquid` file to `templates/` directory        |
| **Integrity check before send** | Part of send flow                    | Compares DB record vs filesystem file before every send                  |
| **Email logging**               | Part of send flow                    | Creates `email_logs` record for every outbound email                     |

### 2.3 Extension Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  Directus Hook Extension                 │
│                                                         │
│  ┌──────────────────┐    ┌────────────────────────────┐ │
│  │  System Emails    │    │  Business Emails            │ │
│  │  (email.send hook)│    │  (called from SvelteKit)    │ │
│  └────────┬─────────┘    └─────────────┬──────────────┘ │
│           │                            │                 │
│           ▼                            ▼                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │           Shared Send Pipeline                      │ │
│  │  1. Resolve template (key + language)               │ │
│  │  2. Integrity check (DB vs filesystem)              │ │
│  │  3. Re-sync if needed                               │ │
│  │  4. Render via Directus mail service                │ │
│  │  5. Log to email_logs                               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.4 File Structure

```
extensions/
  directus-extension-email-system/
    src/
      index.ts              # Hook registration (email.send filter + items hooks)
      send-pipeline.ts      # Shared send logic (resolve, integrity, render, log)
      sync.ts               # DB → filesystem sync logic
      integrity.ts          # Integrity check (compare DB vs file)
      templates/
        system.ts           # System email template key mapping
        variables.ts        # Variable schema definitions per template
      utils/
        language.ts         # User language resolution
        logger.ts           # Structured logging helpers
    package.json
    tsconfig.json
```

---

## 3. DB → Filesystem Sync

### 3.1 Sync Trigger

Templates are synced to the filesystem in two scenarios:

1. **On template save** — `items.create` or `items.update` hook on `email_templates` triggers immediate sync of the changed template.
2. **On send (if integrity check fails)** — Before sending, if the filesystem file is stale or missing, it is re-synced from DB.

### 3.2 Filesystem Path Convention

Templates are written to the `templates/` directory using a predictable naming pattern:

```
templates/{template_key}.liquid          # Default language (fr)
templates/{template_key}.{language}.liquid  # Other languages
```

Examples:

- `templates/registration-confirmed.liquid` (FR — default)
- `templates/registration-confirmed.en.liquid` (EN)
- `templates/password-reset.liquid` (FR — system)
- `templates/password-reset.en.liquid` (EN — system)

### 3.3 Sync Process

1. Read `email_templates` record (subject, body, language, template_key)
2. Wrap body content with base layout reference: `{% layout 'base' %} {% block content %} ... {% endblock %}`
3. Write to `templates/{key}[.{lang}].liquid`
4. Update `email_templates.last_synced_at` timestamp

### 3.4 Base Layout

The existing `base.liquid` / `base.html` layout wraps all emails. It provides:

- HTML boilerplate and responsive email CSS
- Header with organization branding
- Footer with organization name, address, website
- The `{% block content %}` placeholder for template body

---

## 4. Integrity Checks

### 4.1 Check Logic

Before every email send, the extension performs:

```
1. Read email_templates record from DB
2. Read corresponding filesystem file (stat + content)
3. Compare:
   a. Does the file exist?
   b. Is file.mtime >= template.last_synced_at?
   c. Is file content length within tolerance of DB body length?
4. If ANY check fails:
   a. Log warning: "Template {key}/{lang} filesystem mismatch — re-syncing"
   b. Re-sync from DB to filesystem
   c. Update last_synced_at
5. Proceed with send
```

### 4.2 Mismatch Scenarios

| Scenario                         | Action                                 |
| -------------------------------- | -------------------------------------- |
| File missing                     | Re-sync from DB, log warning           |
| File older than DB record        | Re-sync from DB, log warning           |
| File content length differs >10% | Re-sync from DB, log warning           |
| File newer than DB (manual edit) | Re-sync from DB, log warning (DB wins) |
| All checks pass                  | Proceed normally                       |

---

## 5. Template Design

### 5.1 Language Resolution

1. **System emails:** Resolve the target user's language preference from `directus_users.language` field (mapped: `fr-FR` → `fr`, `en-US` → `en`). Default to `fr`.
2. **Business emails:** Resolve from the artist's user account language preference. Default to `fr`.
3. **Guest emails (tickets):** Default to `fr` (no account).

### 5.2 Template Structure

Each template in the DB consists of:

| Field          | Usage                                                               |
| -------------- | ------------------------------------------------------------------- |
| `template_key` | Machine identifier, unique with `language` (e.g. `artist-selected`) |
| `language`     | `fr` or `en`                                                        |
| `subject`      | Email subject line — may contain Liquid variables                   |
| `body`         | Liquid template body (HTML)                                         |
| `variables`    | JSON array of available variable names                              |
| `description`  | Internal note for admins about when/why this template fires         |

### 5.3 Variable Injection

Variables are passed as a flat object to the Liquid engine. Naming convention:

```
artist_name           # Artist display name (artist_name or full_birth_name)
artist_first_name     # First name extracted from full_birth_name
edition_name          # e.g. "26e édition"
edition_number        # e.g. 26
edition_year          # e.g. 2025
art_practice_name     # e.g. "Peinture"
payment_amount        # Formatted amount (e.g. "150,00 $")
payment_deadline      # Formatted date
event_dates           # e.g. "24, 25 et 26 avril 2025"
confirmation_url      # Link to confirm/accept
reset_url             # Password reset link (system emails)
invite_url            # Invitation accept link (system emails)
verify_url            # Email verification link (system emails)
```

---

## 6. System Email Templates

Three system email types are overridden from Directus defaults. The current extension (`directus-extension-system-email-i18n`) handles this via locale JSON files; the new extension will use DB templates instead.

### 6.1 Migration from Current Extension

| Current (locale JSON)              | New (DB template_key) | Notes                                      |
| ---------------------------------- | --------------------- | ------------------------------------------ |
| `password-reset.*` in `fr.json`    | `password-reset`      | Subject, heading, body, CTA, expiry notice |
| `user-invitation.*` in `fr.json`   | `user-invitation`     | Subject, heading, body, CTA                |
| `user-registration.*` in `fr.json` | `user-registration`   | Subject, heading, body, CTA                |

The existing `locales/fr.json` and `locales/en.json` content will be migrated into `email_templates` records during initial seeding.

### 6.2 System Template Variables

| Template Key        | Variables                                   |
| ------------------- | ------------------------------------------- |
| `password-reset`    | `reset_url`, `project_name`, `expiry_hours` |
| `user-invitation`   | `invite_url`, `project_name`                |
| `user-registration` | `verify_url`, `project_name`                |

---

## 7. Business Email Templates

### 7.1 Template Catalog

Templates identified from the business workflow (see [2-BUSINESS_LOGIC.md §2.11](2-BUSINESS_LOGIC.md#211-communications--emails) Email Types table):

| template_key                | Trigger Event                                                  | Recipient | Variables                                                                                                         |
| --------------------------- | -------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `registration-submitted`    | Registration submitted                                         | Artist    | `artist_name`, `edition_name`, `art_practice_name`                                                                |
| `artist-selected`           | Final selection — selected                                     | Artist    | `artist_name`, `edition_name`, `art_practice_name`, `payment_amount`, `payment_deadline`, `confirmation_url`      |
| `artist-waitlisted`         | Final selection — waitlisted                                   | Artist    | `artist_name`, `edition_name`, `art_practice_name`                                                                |
| `artist-rejected`           | Final selection — rejected                                     | Artist    | `artist_name`, `edition_name`, `art_practice_name`                                                                |
| `artist-invited`            | Artist invited by committee                                    | Artist    | `artist_name`, `edition_name`, `art_practice_name`, `invite_url`                                                  |
| `payment-confirmed`         | Payment received                                               | Artist    | `artist_name`, `edition_name`, `payment_amount`, `order_summary`                                                  |
| `payment-reminder`          | Payment overdue                                                | Artist    | `artist_name`, `edition_name`, `payment_amount`, `payment_deadline`, `days_remaining`                             |
| `ticket-confirmed`          | Activity ticket purchased                                      | Buyer     | `buyer_name`, `activity_name`, `event_dates`, `ticket_details`                                                    |
| `campaign-custom`           | Admin-triggered campaign                                       | Artist(s) | Dynamic (admin defines body per send)                                                                             |
| `profile-submitted-receipt` | Public profile edit submitted for review                       | Artist    | `artist_name`, `submitted_at` (Gate 2 only — post-publication edits)                                              |
| `profile-approved`          | Committee approved public profile edit                         | Artist    | `artist_name`, `public_url`, `review_notes` (optional)                                                            |
| `profile-rejected`          | Committee rejected public profile edit                         | Artist    | `artist_name`, `review_notes` (required), `edit_url`                                                              |
| `publication-rejected`      | Committee rejected registration's publication content (Gate 1) | Artist    | `artist_name`, `edition_name`, `review_notes` (required), `edit_url` (to registration publication-content editor) |

### 7.2 Template Seeding

On first setup, the extension (or a seed script) creates default template records in `email_templates` for each `template_key` × `language` combination:

- **FR templates:** Seeded with real French content (informed by `templates/examples for copilot/` reference files)
- **EN templates:** Seeded with placeholder English translations (to be refined later per D5/D8)
- Total initial records: 13 keys × 2 languages = **26 template records** (9 registration/payment/campaign + 4 public-profile review: `profile-submitted-receipt`, `profile-approved`, `profile-rejected`, `publication-rejected`). **No Step-1 templates exist** — artists are never emailed about Step 1 outcomes; outcome emails dispatch only when a registration transitions out of `pending_*` (see §8.2). Additional operational templates — `spot-opened` (waitlist promotion), `deadline-extended` (payment deadline extension), `expiry-notice` (committee-confirmed expiry), `withdraw-ack` (artist self-withdraw), `payment-refunded` (refund issued) — are added at feature-implementation time, not pre-seeded.

---

## 8. Sending Targets & Workflows

### 8.1 Automatic Sends (Not Committee-Gated)

Fired directly by status transitions or webhooks. No human approval needed.

> **Recipient resolution does NOT depend on user role or attached policies.** Recipient addresses are resolved from data columns (`registration.submitter_email`, `order.guest_email`, `artist_public_profiles.artist_id.user_id → directus_users.email`). A user holding multiple policies (e.g. committee-member-artist) still receives their artist-flow emails exactly once, keyed off their `submitter_email` — the policy/capability model does not affect email addressing. See [DIRECTUS_BACKEND_PLAN.md §2](DIRECTUS_BACKEND_PLAN.md).

| Event                         | Template Key                | Recipient Resolution                                                         |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Registration submitted        | `registration-submitted`    | `registration.submitter_email` + `submitter_name_snapshot`                   |
| Payment confirmed (webhook)   | `payment-confirmed`         | `order.registration_id.submitter_email` (or `order.guest_email` for tickets) |
| Ticket purchased              | `ticket-confirmed`          | `order.guest_email`                                                          |
| Public profile edit submitted | `profile-submitted-receipt` | Owner of `artist_public_profiles.artist_id` (Gate 2 receipt)                 |

### 8.2 Committee-Gated Sends (Dispatched Only When `status NOT LIKE 'pending_%'`)

These templates are NEVER fired by a cron, by Step 1 completion, or by an items.update hook on judging data alone. The **canonical email gate is the `status` column**: a transition out of any `pending_*` value is the sole trigger. The endpoints below are the only callers that can effect such a transition.

| Event                                              | Template Key                                                | Triggering endpoint / transition                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Final batch confirmed (select / waitlist / reject) | `artist-selected` / `artist-waitlisted` / `artist-rejected` | `POST /api/admin/registrations/confirm-batch` — grouped by resulting `status`                                                   |
| Direct or converted invitation                     | `artist-invited`                                            | `POST /api/admin/invite` or `POST /api/admin/invite/convert/:id` — `→ invited`                                                  |
| Payment expiry confirmed                           | `expiry-notice`                                             | `POST /api/admin/registrations/confirm-expiry` — `pending_expired → expired`                                                    |
| Public profile approved                            | `profile-approved`                                          | Owner of `artist_public_profiles.artist_id` (via `/api/admin/profile-reviews/{id}/approve`)                                     |
| Public profile rejected                            | `profile-rejected`                                          | Owner of `artist_public_profiles.artist_id`; includes `review_notes` merge field (via `/api/admin/profile-reviews/{id}/reject`) |
| Registration publication rejected (Gate 1)         | `publication-rejected`                                      | `registration.submitter_email` (via `/api/admin/registrations/{id}/reject-publication`); includes `review_notes` and edit link  |

### 8.3 Scheduled / Reminder Sends

| Event                        | Template Key       | Target Resolution                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment deadline approaching | `payment-reminder` | `registration.submitter_email` where `status = 'pending_payment'`, effective deadline (= `COALESCE(payment_extension_granted_until, payment_deadline_at)`) within threshold. Timing-driven and exempt from the `pending_%` gate (no outcome is revealed). |

**Idempotency:** each `payment-reminder` send inserts an `email_logs` row with `(registration_id, template_key='payment-reminder', reminder_stage ∈ {'T-7','T-3','T-1'})`. The unique constraint on `email_logs` (see [4-DB_SCHEMA.md §9](4-DB_SCHEMA.md) and [STATE_MACHINE.md §1 "Idempotency"](STATE_MACHINE.md)) guarantees each `(registration, stage)` fires exactly once even if cron runs multiple times per day or is retried after a crash. This is the **only** idempotency layer for timing-driven emails; the state guard does not apply because the status does not change.

Implementation: SvelteKit cron job (§14.3) or Directus Flow checks daily.

### 8.3 Campaign Sends (Admin-Initiated via SvelteKit UI)

Admins compose campaign emails through the SvelteKit admin interface:

1. **Select template** (or use `campaign-custom` with inline body)
2. **Choose recipients** via filters:
    - All artists of edition X
    - By registration status (multiple select)
    - By art practice
    - Custom pick-list (checkbox selection from artist list)
3. **Preview** rendered email with sample data
4. **Confirm send** → queued for delivery

### 8.4 Send Pipeline

All sends (automated, scheduled, campaign) go through the shared pipeline:

```
1. Resolve template (key + recipient language)
2. Build variables object from context
3. Integrity check (DB vs filesystem)
4. Call Directus MailService.send({
     to: recipient_email,
     subject: rendered_subject,
     template: { name: template_key, data: variables }
   })
5. Create email_logs record (status: 'sent' or 'failed')
```

---

## 9. Email Signature

### 9.1 Standardized Committee Signature

All outgoing business emails include a standardized signature block at the bottom. The signature is **not hardcoded** — it's part of the base layout and sourced from edition-level or organization-level configuration.

### 9.2 Signature Content

```liquid
<div class="signature">
  <p>{{ signature_name }}<br>
  <span>{{ signature_title }} — {{ org_name }}</span></p>
</div>
```

The signature variables are resolved from:

- `edition.signature_name` / `edition.signature_title` (if per-edition signature is set)
- Fallback to organization-level defaults from locale configuration

### 9.3 Current Reference

From the existing example templates, the signature pattern is:

```
France Doyon
Administratrice — Symposium de peinture de Thetford
```

---

## 10. Logging & Auditing

### 10.1 Email Logs Collection

Every outbound email creates a record in `email_logs` (see [4-DB_SCHEMA.md §9](4-DB_SCHEMA.md#9-group-7--communications) for schema).

### 10.2 Log Record Content

| Field             | Populated From                                      |
| ----------------- | --------------------------------------------------- |
| `template_id`     | FK to `email_templates` used (NULL for ad-hoc)      |
| `recipient_email` | Resolved recipient address                          |
| `recipient_name`  | Resolved display name                               |
| `subject`         | Rendered subject line (after variable substitution) |
| `body_snapshot`   | Rendered HTML body (after variable substitution)    |
| `variables_used`  | JSON of actual variable values used for rendering   |
| `status`          | `sent`, `failed`, `pending`, `bounced`              |
| `error_message`   | Error details if send failed                        |
| `sent_at`         | Timestamp of successful send                        |

### 10.3 Resend Capability

From the SvelteKit admin UI, admins can:

- View email logs filtered by date, recipient, status, template
- **Resend a failed email** — re-renders from the current DB template with the logged `variables_used`
- **View rendered body** — display `body_snapshot` for auditing

---

## 11. SvelteKit Admin UI

### 11.1 Template Editor Page

- **Route:** `/admin/email-templates`
- **Features:**
    - List all templates grouped by category (system, registration, judging, payment, activity, campaign)
    - Edit subject + body in a Liquid-aware editor
    - Toggle language tabs (FR / EN)
    - Live preview panel: renders template with sample variable data
    - "Save" triggers Directus API update → extension syncs to filesystem

### 11.2 Campaign Send Page

- **Route:** `/admin/email-campaigns/send`
- **Features:**
    - Select template or compose custom body
    - Recipient filter builder (edition, status, practice, pick-list)
    - Recipient count preview
    - Send confirmation dialog
    - Progress indicator for batch sends

### 11.3 Email Logs Page

- **Route:** `/admin/email-logs`
- **Features:**
    - Searchable/filterable log table
    - Filters: date range, recipient, status, template
    - Detail view: rendered body, variables used, status, error
    - Resend action button for failed emails

---

## 12. Template Variables Reference

Complete reference of all variables available per template:

### Global Variables (available in all templates)

| Variable          | Type   | Source                                  |
| ----------------- | ------ | --------------------------------------- |
| `project_name`    | string | Directus project settings               |
| `org_name`        | string | Organization name from locale config    |
| `org_address`     | string | Organization address from locale config |
| `org_url`         | string | Organization website URL                |
| `signature_name`  | string | Signer name (edition or default)        |
| `signature_title` | string | Signer title (edition or default)       |
| `current_year`    | number | Current calendar year                   |

### Artist Context Variables

| Variable            | Type   | Source                                     |
| ------------------- | ------ | ------------------------------------------ |
| `artist_name`       | string | `artists.artist_name` or `full_birth_name` |
| `artist_first_name` | string | First word of `full_birth_name`            |
| `artist_email`      | string | From linked `directus_users.email`         |

### Edition Context Variables

| Variable            | Type   | Source                                 |
| ------------------- | ------ | -------------------------------------- |
| `edition_name`      | string | Formatted: "{edition_number}e édition" |
| `edition_number`    | number | `edition.edition_number`               |
| `edition_year`      | number | `edition.year`                         |
| `event_dates`       | string | Formatted date range from edition      |
| `art_practice_name` | string | `art_practices.name` from registration |

### Payment Context Variables

| Variable           | Type   | Source                               |
| ------------------ | ------ | ------------------------------------ |
| `payment_amount`   | string | Formatted from `orders.total_amount` |
| `payment_deadline` | string | Formatted date                       |
| `days_remaining`   | number | Computed from deadline - now         |
| `order_summary`    | string | Rendered order items breakdown       |
| `confirmation_url` | string | Link to payment/confirmation page    |

### Activity/Ticket Variables

| Variable         | Type   | Source                                      |
| ---------------- | ------ | ------------------------------------------- |
| `buyer_name`     | string | From order guest_name or artist_name        |
| `activity_name`  | string | `activities.name`                           |
| `ticket_details` | string | Rendered ticket info (date, time, location) |

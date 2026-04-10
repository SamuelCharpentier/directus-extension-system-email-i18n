# Directus i18n for System Emails

This extension translates system emails (password reset, user invitation, user registration) based on each recipient's language setting. It uses a single shared Liquid template per email type and injects translated strings from per-language JSON files — no duplicate templates needed.

<br />

---

<br />

## Installation

Check the [official Directus guide](https://docs.directus.io/extensions/installing-extensions.html) for all options.

### A. Directus Marketplace

Search for `System Email` and install "System Email I18n" with one click.

> To see non-sandboxed extensions in the marketplace, you need to enable them in your [config options](https://docs.directus.io/self-hosted/config-options.html#marketplace).

### B. npm Registry

```sh
npm install directus-extension-system-email-i18n
```

Include the installed package in your Docker build flow.

### C. Extensions Directory

```sh
npm ci && npm run build
```

Upload the output to your Directus extensions directory.

<br />

---

<br />

## How It Works

The extension is a **hook** that intercepts all outgoing emails via the `email.send` filter. For each of the three supported system email types it:

1. Looks up the **recipient's language** from their Directus user profile.
2. Determines the **default language** from `directus_settings.default_language`.
3. Tries to load `<EMAIL_TEMPLATES_PATH>/locales/<user-lang>.json`, falling back to the default-lang file, then giving up (email is sent untouched).
4. Extracts the translation keys for the relevant email type from the locale file.
5. Injects them into the email as `subject`, `from` (sender name), and `template.data.i18n.*` variables available in the Liquid template.

Translation is **always applied** regardless of whether the user's language matches the system default.

<br />

---

<br />

## Environment Variables

| Variable               | Required | Default | Description                                                                                                  |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `EMAIL_TEMPLATES_PATH` | Yes      | —       | Absolute path to the directory containing your `.liquid` templates and `locales/` folder                     |
| `EMAIL_FROM`           | Yes      | `""`    | Sender email address, e.g. `noreply@example.com`. Used when building the `from` field with a translated name |
| `I18N_FALLBACK_LANG`   | No       | `en`    | Language code to use when `directus_settings.default_language` is `null`                                     |

<br />

---

<br />

## Directory Structure

```
EMAIL_TEMPLATES_PATH/
├── password-reset.liquid
├── user-invitation.liquid
├── user-registration.liquid
└── locales/
    ├── en.json
    └── fr.json
```

<br />

---

<br />

## Locale Files

Each locale file is a JSON object with an optional top-level `from_name` and one section per email type.

**`locales/en.json`**

```json
{
	"from_name": "My Project",
	"password-reset": {
		"subject": "Password Reset Request",
		"heading": "Reset your password",
		"body": "We received a request to reset the password for your account.",
		"cta": "Reset Your Password",
		"expiry_notice": "This link expires in 24 hours."
	},
	"user-invitation": {
		"subject": "You have been invited",
		"heading": "You've been invited to {{ projectName }}",
		"body": "Click below to accept your invitation.",
		"cta": "Accept Invitation"
	},
	"user-registration": {
		"subject": "Verify your email address",
		"heading": "Verify your email address",
		"body": "Click below to complete your registration.",
		"cta": "Verify Email"
	}
}
```

**Key rules:**

- `from_name` at the top level is used as the sender display name for all email types unless overridden inside a specific template section.
- `subject` overrides the email subject line.
- Any other keys (e.g. `heading`, `body`, `cta`) become available in the template as `{{ i18n.heading }}`, `{{ i18n.body }}`, etc.
- `subject` and `from_name` are **not** injected into the `i18n` object — they are applied to the email metadata directly.
- If a locale file for the user's language is not found, the default-language file is tried. If neither exists, the email is sent with no changes.

<br />

---

<br />

## Liquid Templates

Each email type has a single shared `.liquid` template. Translated content is made available under the `i18n` object. Directus also provides its own built-in variables.

**`password-reset.liquid`**

```liquid
{% layout "base" %}
{% block content %}

<h1>{{ i18n.heading }}</h1>
<p>{{ i18n.body }}</p>
<a href="{{ url }}">{{ i18n.cta }}</a>
<p><small>{{ i18n.expiry_notice }}</small></p>

{% endblock %}
```

**Available variables:**

| Variable            | Source      | Description                                      |
| ------------------- | ----------- | ------------------------------------------------ |
| `{{ i18n.* }}`      | Locale file | Any key defined in the template's locale section |
| `{{ url }}`         | Directus    | Action URL (reset link, invitation link, etc.)   |
| `{{ projectName }}` | Directus    | Project name from settings                       |

<br />

---

<br />

## Language Resolution

The effective language for each email is resolved as:

1. **User language** — the `language` field on the recipient's `directus_users` record (primary tag only, e.g. `fr` from `fr-CA`).
2. **Default language** — `directus_settings.default_language` (primary tag only).
3. **`I18N_FALLBACK_LANG`** env variable — used if `default_language` is `null`.
4. **`en`** — hardcoded last resort.

The locale file for the user's language is tried first. If it doesn't exist, the default-language file is used. If that doesn't exist either, no translations are applied.

<br />

---

<br />

## Contributing

Anyone is welcome to contribute, but mind the [guidelines](.github/CONTRIBUTING.md):

- [Bug reports](.github/CONTRIBUTING.md#bugs)
- [Feature requests](.github/CONTRIBUTING.md#features)
- [Pull requests](.github/CONTRIBUTING.md#pull-requests)

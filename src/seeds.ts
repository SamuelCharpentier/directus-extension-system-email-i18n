import type { SeedTemplate, SeedTranslation, SeedVariable } from './types';
import { ADMIN_ERROR_KEY, BASE_LAYOUT_KEY } from './constants';

// ─────────────────────────── Default Liquid bodies ───────────────────────────
// These match the files shipped under examples/templates/*.liquid. On
// bootstrap, if an on-disk file already exists at EMAIL_TEMPLATES_PATH/<key>.liquid
// and no DB row exists for that key, the disk contents take precedence so
// existing admin edits from earlier filesystem-based installs are preserved.

export const DEFAULT_BODY_BASE = `<!DOCTYPE html>
<html lang="{{ i18n.base.lang | default: 'en' }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{ projectName }}</title>
  </head>
  <body>
    <div class="container">
      {% block content %}{{ html }}{% endblock %}
      <p class="footer-note">{{ i18n.base.footer_note }}</p>
    </div>
    <div class="footer">
      <h3>{{ i18n.base.org_name }}</h3>
      <p>{{ i18n.base.org_address }}</p>
      <p>{{ i18n.base.org_url }}</p>
      {% block footer %}{% endblock %}
    </div>
  </body>
</html>
`;

export const DEFAULT_BODY_PASSWORD_RESET = `{% layout "base" %}
{% block content %}
<h1>{{ i18n.heading }}</h1>
<p>{{ i18n.body }}</p>
<p class="button-wrapper">
  <a class="button" rel="noopener" target="_blank" href="{{ url }}">{{ i18n.cta }}</a>
</p>
<p>{{ i18n.expiry_notice }}</p>
{% endblock %}
`;

export const DEFAULT_BODY_USER_INVITATION = `{% layout "base" %}
{% block content %}
<h1>{{ i18n.heading }}</h1>
<p>{{ i18n.body }}</p>
<p class="button-wrapper">
  <a class="button" rel="noopener" target="_blank" href="{{ url }}">{{ i18n.cta }}</a>
</p>
{% endblock %}
`;

export const DEFAULT_BODY_USER_REGISTRATION = `{% layout "base" %}
{% block content %}
<h1>{{ i18n.heading }}</h1>
<p>{{ i18n.body }}</p>
<p class="button-wrapper">
  <a class="button" rel="noopener" target="_blank" href="{{ url }}">{{ i18n.cta }}</a>
</p>
{% endblock %}
`;

export const DEFAULT_BODY_ADMIN_ERROR = `{% layout "base" %}
{% block content %}
<h1>{{ i18n.heading }}</h1>
<p>{{ i18n.body }}</p>
<table>
  <tr><td>{{ i18n.reason_label }}</td><td>{{ reason }}</td></tr>
  <tr><td>{{ i18n.timestamp_label }}</td><td>{{ timestamp }}</td></tr>
  <tr><td>{{ i18n.context_label }}</td><td><pre>{{ context }}</pre></td></tr>
</table>
{% endblock %}
`;

// ─────────────────────────── Template rows (language-agnostic) ───────────────────────────
export const SEED_TEMPLATES: SeedTemplate[] = [
	{
		template_key: BASE_LAYOUT_KEY,
		category: 'layout',
		body: DEFAULT_BODY_BASE,
		description: 'Shared layout — other templates extend it via `{% layout "base" %}`.',
	},
	{
		template_key: 'password-reset',
		category: 'system',
		body: DEFAULT_BODY_PASSWORD_RESET,
		description: 'Sent when a user requests a password reset (Directus system email).',
	},
	{
		template_key: 'user-invitation',
		category: 'system',
		body: DEFAULT_BODY_USER_INVITATION,
		description: 'Sent when an admin invites a new user (Directus system email).',
	},
	{
		template_key: 'user-registration',
		category: 'system',
		body: DEFAULT_BODY_USER_REGISTRATION,
		description:
			'Sent when a user registers and needs to verify their email (Directus system email).',
	},
	{
		template_key: ADMIN_ERROR_KEY,
		category: 'system',
		body: DEFAULT_BODY_ADMIN_ERROR,
		description:
			'Internal — sent to all admin-role users when the extension fails to dispatch an email.',
	},
];

// ─────────────────────────── Translations (per template, English suggested copy) ───────────────────────────
// Bootstrap seeds these as a starter for the `en-US` translation row
// when the project's default language is not English. When English IS
// the project default, we skip this copy and seed an empty placeholder
// row so administrators write their own subject + strings rather than
// editing-out the suggested defaults.
export const SEED_TRANSLATIONS: SeedTranslation[] = [
	// base layout strings
	{
		template_key: BASE_LAYOUT_KEY,
		languages_code: 'en-US',
		subject: '',
		from_name: 'Your Organization',
		strings: {
			footer_note: 'If this message does not concern you, you can ignore it or contact us.',
			org_name: 'Your Organization',
			org_address: '123 Example Street, City, Country',
			org_url: 'example.com',
			lang: 'en',
		},
	},

	// password-reset
	{
		template_key: 'password-reset',
		languages_code: 'en-US',
		subject: 'Password Reset Request',
		from_name: null,
		strings: {
			heading: 'Reset your password',
			body: 'We received a request to reset the password for your account. If you did not make this request, you can safely ignore this email.',
			cta: 'Reset Your Password',
			expiry_notice: 'Important: This link will expire in 24 hours.',
		},
	},

	// user-invitation
	{
		template_key: 'user-invitation',
		languages_code: 'en-US',
		subject: 'You have been invited',
		from_name: null,
		strings: {
			heading: "You've been invited!",
			body: 'You have been invited to join. Click the button below to accept this invitation.',
			cta: 'Accept Invitation',
		},
	},

	// user-registration
	{
		template_key: 'user-registration',
		languages_code: 'en-US',
		subject: 'Verify your email address',
		from_name: null,
		strings: {
			heading: 'Verify your email address',
			body: 'Thanks for registering. To complete your registration, verify your email address by clicking the link below.',
			cta: 'Verify Email',
		},
	},

	// admin-error
	{
		template_key: ADMIN_ERROR_KEY,
		languages_code: 'en-US',
		subject: '[Directus] Email dispatch failure: {{ reason }}',
		from_name: null,
		strings: {
			heading: 'Email dispatch failure',
			body: 'The i18n-email extension encountered an error while processing an email. Please review the context below.',
			reason_label: 'Reason',
			context_label: 'Context',
			timestamp_label: 'Timestamp',
		},
	},
];

// ─────────────────────────── Variable registry ───────────────────────────
export const SEED_VARIABLES: SeedVariable[] = [
	{
		template_key: 'password-reset',
		variable_name: 'url',
		is_required: true,
		description: 'Password reset action URL (supplied by Directus).',
		example_value: 'https://example.com/reset?token=abc',
	},
	{
		template_key: 'user-invitation',
		variable_name: 'url',
		is_required: true,
		description: 'Invitation accept URL (supplied by Directus).',
		example_value: 'https://example.com/accept?token=abc',
	},
	{
		template_key: 'user-registration',
		variable_name: 'url',
		is_required: true,
		description: 'Email verification URL (supplied by Directus).',
		example_value: 'https://example.com/verify?token=abc',
	},
	{
		template_key: ADMIN_ERROR_KEY,
		variable_name: 'reason',
		is_required: true,
		description: 'Short human-readable reason for the failure.',
		example_value: 'Missing required variable',
	},
	{
		template_key: ADMIN_ERROR_KEY,
		variable_name: 'context',
		is_required: true,
		description: 'JSON-serialized context detail for debugging.',
		example_value: '{"template":"user-invitation","missing":["url"]}',
	},
	{
		template_key: ADMIN_ERROR_KEY,
		variable_name: 'timestamp',
		is_required: true,
		description: 'ISO 8601 timestamp of the failure.',
		example_value: '2026-04-24T12:00:00.000Z',
	},
];

/** Look up the default body shipped with the extension for a given key. */
export function defaultBodyFor(templateKey: string): string | null {
	const seed = SEED_TEMPLATES.find((s) => s.template_key === templateKey);
	return seed ? seed.body : null;
}

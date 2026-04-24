import type { SeedTemplate, SeedVariable } from './types';
import { ADMIN_ERROR_KEY, BASE_LAYOUT_KEY } from './constants';

/**
 * Seed data for the protected system templates, in FR and EN.
 * Content mirrors the historical examples/templates/locales/*.json so
 * existing installations get the same strings.
 */
export const SEED_TEMPLATES: SeedTemplate[] = [
	// ───── base layout strings (no subject, used only for i18n.base.* in base.liquid) ─────
	{
		template_key: BASE_LAYOUT_KEY,
		language: 'fr',
		category: 'system',
		subject: '',
		from_name: 'Votre organisation',
		strings: {
			footer_note:
				"Si ce message ne vous concerne pas, vous pouvez l'ignorer ou nous contacter.",
			org_name: 'Votre organisation',
			org_address: '123, rue Exemple, Ville, Pays',
			org_url: 'exemple.com',
		},
		description: 'Shared layout strings injected into every email as {{ i18n.base.* }}.',
	},
	{
		template_key: BASE_LAYOUT_KEY,
		language: 'en',
		category: 'system',
		subject: '',
		from_name: 'Your Organization',
		strings: {
			footer_note: 'If this message does not concern you, you can ignore it or contact us.',
			org_name: 'Your Organization',
			org_address: '123 Example Street, City, Country',
			org_url: 'example.com',
		},
		description: 'Shared layout strings injected into every email as {{ i18n.base.* }}.',
	},

	// ───── password-reset ─────
	{
		template_key: 'password-reset',
		language: 'fr',
		category: 'system',
		subject: 'Demande de réinitialisation du mot de passe',
		from_name: null,
		strings: {
			heading: 'Réinitialiser votre mot de passe',
			body: "Nous avons reçu une demande de réinitialisation du mot de passe pour votre compte. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.",
			cta: 'Réinitialiser mon mot de passe',
			expiry_notice: 'Important : Ce lien expirera dans 24 heures.',
		},
		description: 'Sent when a user requests a password reset (Directus system email).',
	},
	{
		template_key: 'password-reset',
		language: 'en',
		category: 'system',
		subject: 'Password Reset Request',
		from_name: null,
		strings: {
			heading: 'Reset your password',
			body: 'We received a request to reset the password for your account. If you did not make this request, you can safely ignore this email.',
			cta: 'Reset Your Password',
			expiry_notice: 'Important: This link will expire in 24 hours.',
		},
		description: 'Sent when a user requests a password reset (Directus system email).',
	},

	// ───── user-invitation ─────
	{
		template_key: 'user-invitation',
		language: 'fr',
		category: 'system',
		subject: 'Vous avez été invité(e)',
		from_name: null,
		strings: {
			heading: 'Vous avez été invité(e)!',
			body: 'Vous avez été invité(e) à rejoindre notre plateforme. Cliquez sur le bouton ci-dessous pour accepter cette invitation.',
			cta: "Accepter l'invitation",
		},
		description: 'Sent when an admin invites a new user (Directus system email).',
	},
	{
		template_key: 'user-invitation',
		language: 'en',
		category: 'system',
		subject: 'You have been invited',
		from_name: null,
		strings: {
			heading: "You've been invited!",
			body: 'You have been invited to join. Click the button below to accept this invitation.',
			cta: 'Accept Invitation',
		},
		description: 'Sent when an admin invites a new user (Directus system email).',
	},

	// ───── user-registration ─────
	{
		template_key: 'user-registration',
		language: 'fr',
		category: 'system',
		subject: 'Vérifiez votre adresse courriel',
		from_name: null,
		strings: {
			heading: 'Vérifiez votre adresse courriel',
			body: 'Merci de vous être inscrit(e). Pour compléter votre inscription, veuillez vérifier votre adresse courriel en cliquant sur le lien ci-dessous.',
			cta: 'Vérifier mon courriel',
		},
		description:
			'Sent when a user registers and needs to verify their email (Directus system email).',
	},
	{
		template_key: 'user-registration',
		language: 'en',
		category: 'system',
		subject: 'Verify your email address',
		from_name: null,
		strings: {
			heading: 'Verify your email address',
			body: 'Thanks for registering. To complete your registration, verify your email address by clicking the link below.',
			cta: 'Verify Email',
		},
		description:
			'Sent when a user registers and needs to verify their email (Directus system email).',
	},

	// ───── admin-error (internal failure notification) ─────
	{
		template_key: ADMIN_ERROR_KEY,
		language: 'fr',
		category: 'system',
		subject: '[Directus] Échec d’envoi de courriel : {{ reason }}',
		from_name: null,
		strings: {
			heading: 'Échec d’envoi de courriel',
			body: "L'extension i18n-email a rencontré une erreur lors du traitement d'un envoi de courriel. Veuillez examiner le contexte ci-dessous.",
			reason_label: 'Motif',
			context_label: 'Contexte',
			timestamp_label: 'Horodatage',
		},
		description:
			'Internal — sent to all admin-role users when the extension fails to dispatch an email.',
	},
	{
		template_key: ADMIN_ERROR_KEY,
		language: 'en',
		category: 'system',
		subject: '[Directus] Email dispatch failure: {{ reason }}',
		from_name: null,
		strings: {
			heading: 'Email dispatch failure',
			body: 'The i18n-email extension encountered an error while processing an email. Please review the context below.',
			reason_label: 'Reason',
			context_label: 'Context',
			timestamp_label: 'Timestamp',
		},
		description:
			'Internal — sent to all admin-role users when the extension fails to dispatch an email.',
	},
];

export const SEED_VARIABLES: SeedVariable[] = [
	// password-reset
	{
		template_key: 'password-reset',
		variable_name: 'url',
		is_required: true,
		description: 'Password reset action URL (supplied by Directus).',
		example_value: 'https://example.com/reset?token=abc',
	},
	{
		template_key: 'password-reset',
		variable_name: 'projectName',
		is_required: false,
		description: 'Project name from directus_settings.project_name.',
		example_value: 'My Project',
	},
	// user-invitation
	{
		template_key: 'user-invitation',
		variable_name: 'url',
		is_required: true,
		description: 'Invitation accept URL (supplied by Directus).',
		example_value: 'https://example.com/accept?token=abc',
	},
	{
		template_key: 'user-invitation',
		variable_name: 'projectName',
		is_required: false,
		description: 'Project name from directus_settings.project_name.',
		example_value: 'My Project',
	},
	// user-registration
	{
		template_key: 'user-registration',
		variable_name: 'url',
		is_required: true,
		description: 'Email verification URL (supplied by Directus).',
		example_value: 'https://example.com/verify?token=abc',
	},
	{
		template_key: 'user-registration',
		variable_name: 'projectName',
		is_required: false,
		description: 'Project name from directus_settings.project_name.',
		example_value: 'My Project',
	},
	// admin-error
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

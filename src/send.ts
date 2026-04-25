import type { EmailOptions, ExtensionsServices, SchemaOverview } from '@directus/types';
import type { Logger } from './types';
import {
	fetchDefaultLang,
	fetchProjectName,
	fetchRecipientUser,
	fetchTemplateWithTranslation,
	fetchUserLang,
} from './directus';
import { applyTranslationsToEmail, extractRecipientEmail } from './email';
import { validateRequiredVariables } from './registry';
import { notifyAdmins, isAdminErrorTemplate } from './admin-alert';
import { BASE_LAYOUT_KEY, isSystemTemplateKey } from './constants';

export type SendFilterDeps = {
	services: ExtensionsServices;
	getSchema: () => Promise<SchemaOverview>;
	logger: Pick<Logger, 'info' | 'warn' | 'error'>;
	env: Record<string, unknown>;
};

/**
 * The `email.send` filter body.
 *
 * 1. Resolve recipient language (user → settings → env → 'en').
 * 2. Fetch template + translation for that language (with fallback).
 * 3. Validate required variables.
 * 4. For protected system emails, hydrate `user` from directus_users.
 * 5. Inject i18n + base strings + subject + from-name into the email.
 *
 * Unknown template names pass through unchanged.
 */
export async function runSendFilter(
	input: EmailOptions,
	deps: SendFilterDeps,
): Promise<EmailOptions> {
	const { services, getSchema, logger, env } = deps;
	const templateName = input.template?.name;
	if (!templateName) return input;
	if (isAdminErrorTemplate(templateName)) return input;

	try {
		const schema = await getSchema();
		const recipientEmail = extractRecipientEmail(input.to);
		const [defaultLang, userLang, projectName] = await Promise.all([
			fetchDefaultLang(services, schema, env),
			recipientEmail ? fetchUserLang(recipientEmail, services, schema) : null,
			fetchProjectName(services, schema),
		]);
		const effectiveLang = userLang ?? defaultLang;

		const resolved = await fetchTemplateWithTranslation(
			templateName,
			effectiveLang,
			defaultLang,
			services,
			schema,
		);
		if (!resolved) {
			logger.info(`[i18n-email] No DB template for "${templateName}" — passing through.`);
			return input;
		}
		const { row, translation } = resolved;

		// Required-variable validation.
		const data = (input.template?.data ?? {}) as Record<string, unknown>;
		const validation = await validateRequiredVariables(templateName, data, services, schema);
		if (!validation.ok) {
			const reason = `Missing required variable(s) for template "${templateName}"`;
			logger.error(
				`[i18n-email] ${reason}: ${validation.missing.join(', ')} — aborting send.`,
			);
			void notifyAdmins(
				reason,
				{
					template: templateName,
					language: translation?.languages_code ?? effectiveLang,
					missing: validation.missing,
					recipient: recipientEmail,
				},
				services,
				schema,
				logger,
			);
			throw new Error(`${reason}: ${validation.missing.join(', ')}`);
		}

		// Base translation for i18n.base.*
		const baseLang = translation?.languages_code ?? effectiveLang;
		const baseResolved = await fetchTemplateWithTranslation(
			BASE_LAYOUT_KEY,
			baseLang,
			defaultLang,
			services,
			schema,
		);
		const baseStrings = baseResolved?.translation?.strings ?? null;

		// User hydration for protected system emails.
		let recipientUser = null;
		if (isSystemTemplateKey(row.template_key) && recipientEmail) {
			const existingUser = (input.template?.data as Record<string, unknown> | undefined)?.[
				'user'
			];
			if (!existingUser) {
				recipientUser = await fetchRecipientUser(recipientEmail, services, schema);
			}
		}

		const envFromName =
			typeof env['I18N_EMAIL_FALLBACK_FROM_NAME'] === 'string'
				? (env['I18N_EMAIL_FALLBACK_FROM_NAME'] as string)
				: null;
		const fallbackFromName = envFromName ?? projectName;
		const fromEnv = typeof env['EMAIL_FROM'] === 'string' ? (env['EMAIL_FROM'] as string) : '';

		applyTranslationsToEmail(input, {
			translation,
			baseStrings,
			fallbackFromName,
			fromEnv,
			recipientUser,
		});
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('Missing required variable')) {
			throw err;
		}
		logger.error(`[i18n-email] Failed to apply translations: ${(err as Error).message}`);
	}

	return input;
}

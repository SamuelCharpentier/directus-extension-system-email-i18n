import type { EmailOptions, HookConfig } from '@directus/types';
import { fetchDefaultLang, fetchProjectName, fetchUserLang } from './directus';
import { applyTranslationsToEmail, extractRecipientEmail } from './email';
import { extractTemplateTrans, resolveLocale } from './locale';

const SYSTEM_EMAIL_TEMPLATES = ['password-reset', 'user-invitation', 'user-registration'] as const;

function isSystemTemplate(name: string): name is (typeof SYSTEM_EMAIL_TEMPLATES)[number] {
	return (SYSTEM_EMAIL_TEMPLATES as readonly string[]).includes(name);
}

const hook: HookConfig = ({ filter }, { services, logger, getSchema, env }) => {
	logger.info('[i18n-email] Hook registered');
	filter('email.send', async (input: EmailOptions) => {
		logger.info(
			`[i18n-email] email.send triggered, template: ${input.template?.name ?? 'none'}`,
		);
		if (!input.template || !isSystemTemplate(input.template.name)) {
			return input;
		}

		try {
			const schema = await getSchema();
			const recipientEmail = extractRecipientEmail(input.to);

			const [defaultLang, userLang, projectName] = await Promise.all([
				fetchDefaultLang(services, schema, env),
				recipientEmail ? fetchUserLang(recipientEmail, services, schema) : null,
				fetchProjectName(services, schema),
			]);
			const effectiveLang = userLang ?? defaultLang;
			logger.info(
				`[i18n-email] effectiveLang: ${effectiveLang}, templatesPath: ${env['EMAIL_TEMPLATES_PATH']}`,
			);
			const templatesPath =
				typeof env['EMAIL_TEMPLATES_PATH'] === 'string' ? env['EMAIL_TEMPLATES_PATH'] : '';
			const locale = await resolveLocale(templatesPath, effectiveLang, defaultLang);

			if (!locale) {
				logger.warn('[i18n-email] No locale file found, skipping translation');
				return input;
			}

			const trans = extractTemplateTrans(locale, input.template.name);

			if (!trans) return input;

			const fromEnv = typeof env['EMAIL_FROM'] === 'string' ? env['EMAIL_FROM'] : '';
			const envFromName =
				typeof env['I18N_EMAIL_FALLBACK_FROM_NAME'] === 'string'
					? env['I18N_EMAIL_FALLBACK_FROM_NAME']
					: undefined;
			const effectiveTrans = trans.from_name
				? trans
				: { ...trans, from_name: envFromName ?? projectName ?? undefined };
			applyTranslationsToEmail(input, effectiveTrans, fromEnv);

			const baseTrans = extractTemplateTrans(locale, 'base');
			if (baseTrans && input.template) {
				const baseI18n = Object.fromEntries(
					Object.entries(baseTrans).filter(([_, v]) => typeof v === 'string'),
				);
				const existing = (input.template.data?.['i18n'] as Record<string, unknown>) ?? {};
				input.template.data = { ...input.template.data, i18n: { ...existing, base: baseI18n } };
			}
		} catch (err) {
			logger.error('Failed to apply email i18n translations:', err);
		}

		return input;
	});
};

export default hook;

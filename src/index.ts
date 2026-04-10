import type { EmailOptions, HookConfig } from '@directus/types';
import { fetchDefaultLang, fetchProjectName, fetchUserLang } from './directus';
import { applyTranslationsToEmail, extractRecipientEmail } from './email';
import { extractTemplateTrans, resolveLocale } from './locale';

const SYSTEM_EMAIL_TEMPLATES = ['password-reset', 'user-invitation', 'user-registration'] as const;

function isSystemTemplate(name: string): name is (typeof SYSTEM_EMAIL_TEMPLATES)[number] {
	return (SYSTEM_EMAIL_TEMPLATES as readonly string[]).includes(name);
}

const hook: HookConfig = ({ filter }, { services, logger, getSchema, env }) => {
	filter('email.send', async (input: EmailOptions) => {
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
			const templatesPath =
				typeof env['EMAIL_TEMPLATES_PATH'] === 'string' ? env['EMAIL_TEMPLATES_PATH'] : '';
			const locale = await resolveLocale(templatesPath, effectiveLang, defaultLang);

			if (!locale) return input;

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
		} catch (err) {
			logger.error('Failed to apply email i18n translations:', err);
		}

		return input;
	});
};

export default hook;

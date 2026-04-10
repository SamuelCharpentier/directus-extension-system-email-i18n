import type { ExtensionsServices, SchemaOverview } from '@directus/types';

const HARDCODED_FALLBACK_LANG = 'en';

export async function fetchDefaultLang(
	services: ExtensionsServices,
	schema: SchemaOverview,
	env: Record<string, unknown>,
): Promise<string> {
	const settings = new services.SettingsService({ schema, accountability: null });
	const result = await settings.readSingleton({ fields: ['default_language'] });
	const lang = result['default_language'];
	const [primary] = typeof lang === 'string' ? lang.split('-') : [];
	const envFallback =
		typeof env['I18N_FALLBACK_LANG'] === 'string'
			? env['I18N_FALLBACK_LANG']
			: HARDCODED_FALLBACK_LANG;
	return primary ?? envFallback;
}

export async function fetchUserLang(
	recipientEmail: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<string | null> {
	const users = new services.ItemsService('directus_users', { schema, accountability: null });
	const results = await users.readByQuery({
		filter: { email: { _eq: recipientEmail } },
		fields: ['language'],
		limit: 1,
	});
	const lang = results[0]?.['language'];
	const [primary] = typeof lang === 'string' ? lang.split('-') : [];
	return primary ?? null;
}

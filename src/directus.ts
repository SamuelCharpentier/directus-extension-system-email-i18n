import type { ExtensionsServices, SchemaOverview } from '@directus/types';
import {
	DEFAULT_FALLBACK_LANG,
	TEMPLATES_COLLECTION,
	TRANSLATIONS_COLLECTION,
	VARIABLES_COLLECTION,
} from './constants';
import type {
	EmailTemplateRow,
	EmailTemplateTranslationRow,
	EmailTemplateVariableRow,
	RecipientUser,
} from './types';

function normaliseLang(lang: unknown): string | null {
	return typeof lang === 'string' && lang.length > 0 ? lang : null;
}

export async function fetchDefaultLang(
	services: ExtensionsServices,
	schema: SchemaOverview,
	env: Record<string, unknown>,
): Promise<string> {
	const settings = new services.SettingsService({ schema, accountability: null });
	const result = await settings.readSingleton({ fields: ['default_language'] });
	const settingsLang = normaliseLang(result['default_language']);
	if (settingsLang) return settingsLang;
	const envLang = normaliseLang(env['I18N_EMAIL_FALLBACK_LANG']);
	return envLang ?? DEFAULT_FALLBACK_LANG;
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
	return normaliseLang(results[0]?.['language']);
}

export async function fetchProjectName(
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<string | null> {
	const settings = new services.SettingsService({ schema, accountability: null });
	const result = await settings.readSingleton({ fields: ['project_name'] });
	const name = result['project_name'];
	return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * Fetch one active template row by template_key.
 */
export async function fetchTemplateRow(
	templateKey: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<EmailTemplateRow | null> {
	const items = new services.ItemsService(TEMPLATES_COLLECTION, { schema, accountability: null });
	const results = await items.readByQuery({
		filter: {
			template_key: { _eq: templateKey },
			is_active: { _eq: true },
		},
		limit: 1,
	});
	return (results[0] as EmailTemplateRow | undefined) ?? null;
}

export async function fetchAllTemplateRows(
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<EmailTemplateRow[]> {
	const items = new services.ItemsService(TEMPLATES_COLLECTION, { schema, accountability: null });
	const results = await items.readByQuery({ limit: -1 });
	return results as EmailTemplateRow[];
}

/**
 * Fetch one translation row for a given template id + language.
 */
export async function fetchTranslationRow(
	templateId: string,
	languagesCode: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<EmailTemplateTranslationRow | null> {
	const items = new services.ItemsService(TRANSLATIONS_COLLECTION, {
		schema,
		accountability: null,
	});
	const results = await items.readByQuery({
		filter: {
			email_templates_id: { _eq: templateId },
			languages_code: { _eq: languagesCode },
		},
		limit: 1,
	});
	return (results[0] as EmailTemplateTranslationRow | undefined) ?? null;
}

/**
 * Resolve a template row + its best-fit translation for the effective
 * language, falling back to the default language if needed. A
 * translation row is treated as "no usable translation" (and the
 * fallback chain continues) when its `subject` is empty AND its
 * `strings` map is null/undefined/empty — this is the empty
 * placeholder shape the bootstrap seeds for the project's default
 * language. Returns null when the template itself is missing; returns
 * `{ row, translation: null }` when the template exists but has no
 * usable translation in either language.
 */
function isUsableTranslation(t: EmailTemplateTranslationRow | null): boolean {
	if (!t) return false;
	const hasSubject = typeof t.subject === 'string' && t.subject.length > 0;
	const strings = t.strings;
	const hasStrings =
		strings !== null &&
		strings !== undefined &&
		typeof strings === 'object' &&
		Object.keys(strings).length > 0;
	return hasSubject || hasStrings;
}

export async function fetchTemplateWithTranslation(
	templateKey: string,
	effectiveLang: string,
	defaultLang: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<{ row: EmailTemplateRow; translation: EmailTemplateTranslationRow | null } | null> {
	const row = await fetchTemplateRow(templateKey, services, schema);
	if (!row || !row.id) return null;
	let translation = await fetchTranslationRow(row.id, effectiveLang, services, schema);
	if (!isUsableTranslation(translation) && effectiveLang !== defaultLang) {
		translation = await fetchTranslationRow(row.id, defaultLang, services, schema);
	}
	return { row, translation };
}

export async function fetchTemplateVariables(
	templateKey: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<EmailTemplateVariableRow[]> {
	const items = new services.ItemsService(VARIABLES_COLLECTION, {
		schema,
		accountability: null,
	});
	const results = await items.readByQuery({
		filter: { template_key: { _eq: templateKey } },
		limit: -1,
	});
	return results as EmailTemplateVariableRow[];
}

export async function fetchAdminEmails(
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<string[]> {
	const users = new services.ItemsService('directus_users', {
		schema,
		accountability: null,
	});
	const results = await users.readByQuery({
		filter: {
			status: { _eq: 'active' },
			role: { admin_access: { _eq: true } },
		},
		fields: ['email'],
		limit: -1,
	});
	// Post-filter: drop rows whose email is null/empty/non-string. Cheaper
	// than coupling the mock filter engine to `_nnull`.
	return results
		.map((u: Record<string, unknown>) => u['email'])
		.filter((e): e is string => typeof e === 'string' && e.length > 0);
}

/**
 * Look up the recipient user (by email) for auto-hydration into the
 * Liquid template as `user`. Returns null when the recipient is not a
 * known Directus user — non-fatal.
 */
export async function fetchRecipientUser(
	recipientEmail: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<RecipientUser | null> {
	const users = new services.ItemsService('directus_users', { schema, accountability: null });
	const results = await users.readByQuery({
		filter: { email: { _eq: recipientEmail } },
		fields: ['id', 'first_name', 'last_name', 'email', 'language'],
		limit: 1,
	});
	const row = results[0];
	if (!row) return null;
	return {
		id: String(row['id']),
		first_name: (row['first_name'] as string | null) ?? null,
		last_name: (row['last_name'] as string | null) ?? null,
		email: String(row['email']),
		language: (row['language'] as string | null) ?? null,
	};
}

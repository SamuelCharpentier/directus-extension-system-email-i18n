import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExtensionsServices, SchemaOverview } from '@directus/types';
import type { Logger } from './types';
import { fetchAllTemplateRows } from './directus';
import { BASE_LAYOUT_KEY } from './constants';
import type { EmailTemplateRow, LocaleData, TemplateTrans } from './types';

/**
 * Build the LocaleData object for a single language from a flat list of
 * active template rows. Shape matches what src/locale.ts and
 * applyTranslationsToEmail already consume.
 */
export function buildLocaleData(rows: EmailTemplateRow[]): LocaleData {
	const locale: LocaleData = {};
	for (const row of rows) {
		const trans: TemplateTrans = { ...row.strings };
		if (row.subject) trans.subject = row.subject;
		if (row.from_name) trans.from_name = row.from_name;
		locale[row.template_key] = trans;
	}
	// Promote base row's from_name to top-level org default when present.
	const base = rows.find((r) => r.template_key === BASE_LAYOUT_KEY);
	if (base?.from_name) locale.from_name = base.from_name;
	return locale;
}

/**
 * Group template rows by language.
 */
function groupByLanguage(rows: EmailTemplateRow[]): Map<string, EmailTemplateRow[]> {
	const map = new Map<string, EmailTemplateRow[]>();
	for (const row of rows) {
		const bucket = map.get(row.language) ?? [];
		bucket.push(row);
		map.set(row.language, bucket);
	}
	return map;
}

/**
 * Atomic JSON write: write to a temp file, then rename over target.
 * Prevents partial files being read mid-write by a concurrent send.
 */
async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
	await mkdir(dirname(targetPath), { recursive: true });
	const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
	await rename(tmp, targetPath);
}

export function localeFilePath(templatesPath: string, language: string): string {
	return join(templatesPath, 'locales', `${language}.json`);
}

/**
 * Rebuild every locales/{lang}.json file from the current DB rows.
 */
export async function syncAllLocales(
	templatesPath: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<void> {
	if (!templatesPath) {
		logger.warn('[i18n-email] EMAIL_TEMPLATES_PATH not set — skipping locale file sync.');
		return;
	}
	const rows = await fetchAllTemplateRows(services, schema);
	const grouped = groupByLanguage(rows);
	for (const [language, langRows] of grouped) {
		const locale = buildLocaleData(langRows);
		const target = localeFilePath(templatesPath, language);
		try {
			await atomicWriteJson(target, locale);
			logger.info(
				`[i18n-email] Synced locales/${language}.json (${langRows.length} templates).`,
			);
		} catch (err) {
			logger.error(`[i18n-email] Failed to write ${target}: ${(err as Error).message}`);
		}
	}
}

/**
 * Rebuild a single locales/{lang}.json from the current DB rows.
 */
export async function syncLocale(
	language: string,
	templatesPath: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn' | 'error'>,
): Promise<void> {
	if (!templatesPath) return;
	const rows = (await fetchAllTemplateRows(services, schema)).filter(
		(r) => r.language === language,
	);
	const target = localeFilePath(templatesPath, language);
	await atomicWriteJson(target, buildLocaleData(rows));
	logger.info(`[i18n-email] Synced locales/${language}.json (${rows.length} templates).`);
}

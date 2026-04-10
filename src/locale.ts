import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocaleData, TemplateTrans } from './types';

async function loadLocaleFile(templatesPath: string, lang: string): Promise<LocaleData | null> {
const filePath = join(templatesPath, 'locales', `${lang}.json`);
try {
const content = await readFile(filePath, 'utf-8');
return JSON.parse(content) as LocaleData;
} catch {
return null;
}
}

export async function resolveLocale(
templatesPath: string,
userLang: string,
defaultLang: string,
): Promise<LocaleData | null> {
if (!templatesPath) return null;
return (await loadLocaleFile(templatesPath, userLang)) ?? (await loadLocaleFile(templatesPath, defaultLang));
}

export function extractTemplateTrans(locale: LocaleData, templateName: string): TemplateTrans | null {
const section = locale[templateName];
if (typeof section !== 'object' || section === null) return null;

const trans = section as TemplateTrans;
const topLevelFromName = typeof locale.from_name === 'string' ? locale.from_name : undefined;

if (!trans.from_name && topLevelFromName) {
return { ...trans, from_name: topLevelFromName };
}

return trans;
}

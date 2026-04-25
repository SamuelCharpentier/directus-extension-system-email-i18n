import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExtensionsServices, SchemaOverview } from '@directus/types';
import type { EmailTemplateRow, Logger } from './types';
import { SYNC_AUDIT_COLLECTION, TEMPLATES_COLLECTION } from './constants';
import { computeChecksum } from './integrity';

/** Disk path for a template body file. */
export function templateFilePath(templatesPath: string, templateKey: string): string {
	return join(templatesPath, `${templateKey}.liquid`);
}

/**
 * Atomic text write: write to a temp file, then rename over target.
 * Prevents partial files being read mid-write by a concurrent send.
 */
async function atomicWriteText(targetPath: string, data: string): Promise<void> {
	await mkdir(dirname(targetPath), { recursive: true });
	const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, data, 'utf-8');
	await rename(tmp, targetPath);
}

/** Read existing body from disk if present, otherwise null. */
export async function readTemplateFromDisk(
	templatesPath: string,
	templateKey: string,
): Promise<string | null> {
	if (!templatesPath) return null;
	try {
		return await readFile(templateFilePath(templatesPath, templateKey), 'utf-8');
	} catch {
		return null;
	}
}

async function writeAudit(
	templateKey: string,
	reason: string,
	action: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'warn'>,
): Promise<void> {
	try {
		const items = new services.ItemsService(SYNC_AUDIT_COLLECTION, {
			schema,
			accountability: null,
		});
		await items.createOne({ template_key: templateKey, reason, action });
	} catch (err) {
		logger.warn(`[i18n-email] Audit row skipped: ${(err as Error).message}`);
	}
}

/**
 * Write a single template body to disk and update the row's
 * `checksum` + `last_synced_at`. Safe to call repeatedly; only the
 * body file and the two metadata fields are touched.
 */
export async function syncTemplateBody(
	row: EmailTemplateRow,
	templatesPath: string,
	services: ExtensionsServices,
	schema: SchemaOverview,
	logger: Pick<Logger, 'info' | 'warn' | 'error'>,
	reason = 'body-write',
): Promise<void> {
	if (!templatesPath) {
		logger.warn('[i18n-email] EMAIL_TEMPLATES_PATH not set — skipping body sync.');
		return;
	}
	const target = templateFilePath(templatesPath, row.template_key);
	try {
		await atomicWriteText(target, row.body);
	} catch (err) {
		logger.error(`[i18n-email] Failed to write ${target}: ${(err as Error).message}`);
		return;
	}
	logger.info(`[i18n-email] Synced ${row.template_key}.liquid.`);

	await writeAudit(row.template_key, reason, 'body-write', services, schema, logger);

	if (row.id) {
		try {
			const items = new services.ItemsService(TEMPLATES_COLLECTION, {
				schema,
				accountability: null,
			});
			await items.updateOne(row.id, {
				checksum: computeChecksum({ body: row.body }),
				last_synced_at: new Date().toISOString(),
			});
		} catch (err) {
			logger.warn(
				`[i18n-email] Failed to update sync metadata for ${row.template_key}: ${(err as Error).message}`,
			);
		}
	}
}

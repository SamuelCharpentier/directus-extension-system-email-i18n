import type { EmailOptions, HookConfig } from '@directus/types';
import { runBootstrap } from './bootstrap';
import { runSendFilter } from './send';
import { syncLocale } from './sync';
import { TEMPLATES_COLLECTION, VARIABLES_COLLECTION } from './constants';
import { computeChecksum } from './integrity';
import type { EmailTemplateRow, EmailTemplateVariableRow } from './types';

function templatesPathFromEnv(env: Record<string, unknown>): string {
	return typeof env['EMAIL_TEMPLATES_PATH'] === 'string'
		? (env['EMAIL_TEMPLATES_PATH'] as string)
		: '';
}

const hook: HookConfig = ({ filter, action }, { services, logger, getSchema, env }) => {
	logger.info('[i18n-email] Hook registered.');

	// ──────────── Bootstrap (schema + seeds + initial sync) ────────────
	action('server.start', async () => {
		await runBootstrap(templatesPathFromEnv(env), services, getSchema, logger);
	});

	// ──────────── email.send filter ────────────
	filter('email.send', async (payload: unknown) => {
		const input = payload as EmailOptions;
		return runSendFilter(input, { services, getSchema, logger, env });
	});

	// ──────────── Template CRUD → sync locale files ────────────
	action(`${TEMPLATES_COLLECTION}.items.create`, async (meta: unknown) => {
		const row = (meta as { payload?: Partial<EmailTemplateRow> }).payload;
		if (!row) return;
		if (!row.language) return;
		try {
			const schema = await getSchema();
			await syncLocale(row.language, templatesPathFromEnv(env), services, schema, logger);
		} catch (err) {
			logger.error(`[i18n-email] Post-write sync failed: ${(err as Error).message}`);
		}
	});

	action(`${TEMPLATES_COLLECTION}.items.update`, async (meta: unknown) => {
		const keys = ((meta as { keys?: string[] }).keys ?? []) as string[];
		if (keys.length === 0) return;
		try {
			const schema = await getSchema();
			const items = new services.ItemsService(TEMPLATES_COLLECTION, {
				schema,
				accountability: null,
			});
			const rows = (await items.readMany(keys)) as EmailTemplateRow[];
			const languages = new Set(rows.map((r) => r.language).filter(Boolean));
			for (const lang of languages) {
				await syncLocale(lang, templatesPathFromEnv(env), services, schema, logger);
			}
		} catch (err) {
			logger.error(`[i18n-email] Post-update sync failed: ${(err as Error).message}`);
		}
	});

	// ──────────── Checksum maintenance ────────────
	filter(`${TEMPLATES_COLLECTION}.items.create`, async (payload: unknown) => {
		const row = payload as Partial<EmailTemplateRow>;
		row.checksum = computeChecksum({
			subject: row.subject ?? '',
			from_name: row.from_name ?? null,
			strings: (row.strings ?? {}) as Record<string, string>,
		});
		return row;
	});

	filter(`${TEMPLATES_COLLECTION}.items.update`, async (payload: unknown, meta: unknown) => {
		const patch = payload as Partial<EmailTemplateRow>;
		if (!('subject' in patch) && !('from_name' in patch) && !('strings' in patch)) {
			return patch;
		}
		try {
			const keys = ((meta as { keys?: string[] }).keys ?? []) as string[];
			if (keys.length !== 1) return patch;
			const schema = await getSchema();
			const items = new services.ItemsService(TEMPLATES_COLLECTION, {
				schema,
				accountability: null,
			});
			const existing = (await items.readOne(keys[0]!)) as EmailTemplateRow;
			const merged = { ...existing, ...patch };
			patch.checksum = computeChecksum({
				subject: merged.subject ?? '',
				from_name: merged.from_name ?? null,
				strings: (merged.strings ?? {}) as Record<string, string>,
			});
		} catch (err) {
			logger.warn(`[i18n-email] Checksum recompute skipped: ${(err as Error).message}`);
		}
		return patch;
	});

	// ──────────── Protected-row delete guard ────────────
	filter(`${TEMPLATES_COLLECTION}.items.delete`, async (payload: unknown) => {
		const ids = ((payload as (string | number)[] | undefined) ?? []).map(String);
		if (ids.length === 0) return payload;
		const schema = await getSchema();
		const items = new services.ItemsService(TEMPLATES_COLLECTION, {
			schema,
			accountability: null,
		});
		const rows = (await items.readMany(ids, {
			fields: ['id', 'template_key', 'is_protected'],
		})) as Array<Pick<EmailTemplateRow, 'template_key' | 'is_protected'>>;
		const blocked = rows.filter((r) => r.is_protected);
		if (blocked.length > 0) {
			const keys = blocked.map((r) => r.template_key).join(', ');
			throw new Error(
				`[i18n-email] Cannot delete protected template row(s): ${keys}. Protected rows can be edited but not removed.`,
			);
		}
		return payload;
	});

	filter(`${VARIABLES_COLLECTION}.items.delete`, async (payload: unknown) => {
		const ids = ((payload as (string | number)[] | undefined) ?? []).map(String);
		if (ids.length === 0) return payload;
		const schema = await getSchema();
		const items = new services.ItemsService(VARIABLES_COLLECTION, {
			schema,
			accountability: null,
		});
		const rows = (await items.readMany(ids, {
			fields: ['id', 'template_key', 'variable_name', 'is_protected'],
		})) as EmailTemplateVariableRow[];
		const blocked = rows.filter((r) => r.is_protected);
		if (blocked.length > 0) {
			const keys = blocked.map((r) => `${r.template_key}.${r.variable_name}`).join(', ');
			throw new Error(
				`[i18n-email] Cannot delete protected variable registry entr(ies): ${keys}.`,
			);
		}
		return payload;
	});
};

export default hook;

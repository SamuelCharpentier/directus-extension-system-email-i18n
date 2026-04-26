import type { EmailOptions, HookConfig } from '@directus/types';
import { runBootstrap } from './bootstrap';
import { runSendFilter } from './send';
import { syncTemplateBody } from './sync';
import { TEMPLATES_COLLECTION, VARIABLES_COLLECTION } from './constants';
import { computeChecksum } from './integrity';
import type { EmailTemplateRow, EmailTemplateVariableRow } from './types';

function templatesPathFromEnv(env: Record<string, unknown>): string {
	return typeof env['EMAIL_TEMPLATES_PATH'] === 'string'
		? (env['EMAIL_TEMPLATES_PATH'] as string)
		: '';
}

const hook: HookConfig = ({ filter, action, init }, { services, logger, getSchema, env }) => {
	logger.info('[i18n-email] Hook registered.');

	// Bootstrap is intentionally fire-and-forget so it does NOT block
	// Directus's startup pipeline. On a fresh DB the work (collection
	// creation + seeds + body flush) takes 30-40s; awaiting it inside
	// the `server.start` hook would freeze the API for that whole
	// window. Each entry point below kicks the same idempotent
	// `runBootstrap` promise (it coalesces concurrent calls) and
	// returns immediately. Errors are logged inside runBootstrap.
	const kickBootstrap = (): void => {
		void runBootstrap(templatesPathFromEnv(env), services, getSchema, env, logger);
	};

	if (typeof init === 'function') {
		try {
			init('app.after', () => kickBootstrap());
		} catch {
			// Older Directus versions don't support this init event — fine.
		}
	}
	action('server.start', () => kickBootstrap());
	// Eager kick-off — runBootstrap guards against concurrent runs.
	kickBootstrap();

	// ──────────── email.send filter ────────────
	filter('email.send', async (payload: unknown) => {
		const input = payload as EmailOptions;
		return runSendFilter(input, { services, getSchema, logger, env });
	});

	// ──────────── Body sync on create/update ────────────
	action(`${TEMPLATES_COLLECTION}.items.create`, async (meta: unknown) => {
		const row = (meta as { key?: string; payload?: Partial<EmailTemplateRow> }).payload;
		if (!row || !row.template_key) return;
		try {
			const schema = await getSchema();
			const key = (meta as { key?: string }).key;
			const full: EmailTemplateRow = {
				id: key ? String(key) : row.id,
				template_key: row.template_key,
				category: row.category ?? 'custom',
				body: row.body ?? '',
				description: row.description ?? null,
				is_active: row.is_active ?? true,
				is_protected: row.is_protected ?? false,
				checksum: row.checksum ?? '',
				last_synced_at: row.last_synced_at ?? null,
			};
			await syncTemplateBody(
				full,
				templatesPathFromEnv(env),
				services,
				schema,
				logger,
				'body-create',
			);
		} catch (err) {
			logger.error(`[i18n-email] Post-create sync failed: ${(err as Error).message}`);
		}
	});

	action(`${TEMPLATES_COLLECTION}.items.update`, async (meta: unknown) => {
		const keys = ((meta as { keys?: string[] }).keys ?? []) as string[];
		const patch = (meta as { payload?: Partial<EmailTemplateRow> }).payload ?? {};
		// Only resync when body changed (or when we don't know the patch).
		if (keys.length === 0) return;
		if (Object.keys(patch).length > 0 && !('body' in patch) && !('template_key' in patch)) {
			return;
		}
		try {
			const schema = await getSchema();
			const items = new services.ItemsService(TEMPLATES_COLLECTION, {
				schema,
				accountability: null,
			});
			const rows = (await items.readMany(keys)) as EmailTemplateRow[];
			for (const row of rows) {
				await syncTemplateBody(
					row,
					templatesPathFromEnv(env),
					services,
					schema,
					logger,
					'body-update',
				);
			}
		} catch (err) {
			logger.error(`[i18n-email] Post-update sync failed: ${(err as Error).message}`);
		}
	});

	// ──────────── Checksum maintenance ────────────
	filter(`${TEMPLATES_COLLECTION}.items.create`, async (payload: unknown) => {
		const row = payload as Partial<EmailTemplateRow>;
		row.checksum = computeChecksum({ body: row.body ?? '' });
		return row;
	});

	filter(`${TEMPLATES_COLLECTION}.items.update`, async (payload: unknown) => {
		const patch = payload as Partial<EmailTemplateRow>;
		if ('body' in patch) {
			patch.checksum = computeChecksum({ body: patch.body ?? '' });
		}
		return patch;
	});

	// ──────────── Protected-row delete guards ────────────
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

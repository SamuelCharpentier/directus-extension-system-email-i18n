import { describe, it, expect, vi, beforeEach } from 'vitest';

const fsMocks = vi.hoisted(() => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	rename: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:fs/promises', () => fsMocks);

import { emptySchema, makeLogger, makeServices } from './helpers';
import { __INTERNAL__ } from '../src/bootstrap';
import hook from '../src/index';

type HookRegistry = {
	filters: Record<string, (payload: any, meta?: any) => Promise<any> | any>;
	actions: Record<string, (meta: any) => Promise<any> | any>;
};

function register(args: {
	services: any;
	getSchema?: () => Promise<any>;
	env?: Record<string, unknown>;
}): { logger: ReturnType<typeof makeLogger>; reg: HookRegistry } {
	const reg: HookRegistry = { filters: {}, actions: {} };
	const logger = makeLogger();
	hook(
		{
			filter: ((name: string, fn: any) => {
				reg.filters[name] = fn;
			}) as any,
			action: ((name: string, fn: any) => {
				reg.actions[name] = fn;
			}) as any,
			init: (() => {}) as any,
			schedule: (() => {}) as any,
			embed: (() => {}) as any,
		},
		{
			services: args.services,
			logger: logger as any,
			getSchema: args.getSchema ?? vi.fn().mockResolvedValue(emptySchema),
			env: args.env ?? {},
			database: {} as any,
			emitter: {} as any,
		} as any,
	);
	return { logger, reg };
}

beforeEach(() => {
	__INTERNAL__.reset();
	fsMocks.writeFile.mockClear();
	fsMocks.rename.mockClear();
});

describe('hook registration', () => {
	it('registers every expected filter and action', () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		expect(Object.keys(reg.filters).sort()).toEqual(
			[
				'email.send',
				'email_templates.items.create',
				'email_templates.items.update',
				'email_templates.items.delete',
				'email_template_variables.items.delete',
			].sort(),
		);
		expect(Object.keys(reg.actions).sort()).toEqual(
			['server.start', 'email_templates.items.create', 'email_templates.items.update'].sort(),
		);
	});
});

describe('server.start action', () => {
	it('runs bootstrap with EMAIL_TEMPLATES_PATH from env', async () => {
		const { services, collectionsInstance } = makeServices({
			collections: {
				readOne: vi.fn().mockResolvedValue({ collection: 'x' }),
				createOne: vi.fn(),
			},
		});
		const { reg } = register({
			services,
			env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' },
		});
		await reg.actions['server.start']!({});
		expect(collectionsInstance.readOne).toHaveBeenCalled();
	});

	it('falls back to empty path when env is absent', async () => {
		const { services } = makeServices({
			collections: {
				readOne: vi.fn().mockResolvedValue({ collection: 'x' }),
				createOne: vi.fn(),
			},
		});
		const { reg } = register({ services });
		await reg.actions['server.start']!({});
		// No write should happen without a path
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});
});

describe('email.send filter', () => {
	it('delegates to runSendFilter and passes through when there is no template', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		const input = { to: 'a@b.com', subject: 'x' };
		const out = await reg.filters['email.send']!(input);
		expect(out).toBe(input);
	});
});

describe('template items.create action (post-write sync)', () => {
	it('rebuilds the locale file for the created language', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readByQuery: vi
						.fn()
						.mockResolvedValue([
							{ template_key: 'x', language: 'fr', strings: { a: 'b' } },
						]),
				},
			},
		});
		const { reg } = register({ services, env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' } });
		await reg.actions['email_templates.items.create']!({
			payload: { language: 'fr' },
		});
		expect(fsMocks.writeFile).toHaveBeenCalled();
	});

	it('is a no-op when no language is on the payload', async () => {
		const { services } = makeServices();
		const { reg } = register({ services, env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' } });
		await reg.actions['email_templates.items.create']!({ payload: {} });
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});

	it('is a no-op when meta has no payload object at all', async () => {
		const { services } = makeServices();
		const { reg } = register({ services, env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' } });
		await reg.actions['email_templates.items.create']!({});
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});

	it('logs an error when post-write sync fails', async () => {
		fsMocks.writeFile.mockRejectedValueOnce(new Error('disk full'));
		const { services } = makeServices({
			items: {
				email_templates: {
					readByQuery: vi
						.fn()
						.mockResolvedValue([{ template_key: 'x', language: 'fr', strings: {} }]),
				},
			},
		});
		const { logger, reg } = register({
			services,
			env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' },
		});
		await reg.actions['email_templates.items.create']!({ payload: { language: 'fr' } });
		expect(logger.error).toHaveBeenCalled();
	});
});

describe('template items.update action (post-write sync)', () => {
	it('is a no-op when keys is empty', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		await reg.actions['email_templates.items.update']!({ keys: [] });
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});

	it('is a no-op when meta has no keys field', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		await reg.actions['email_templates.items.update']!({});
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});

	it('resyncs every affected language', async () => {
		const rows = [
			{ template_key: 'a', language: 'fr', strings: {} },
			{ template_key: 'b', language: 'en', strings: {} },
		];
		const { services } = makeServices({
			items: {
				email_templates: {
					readMany: vi.fn().mockResolvedValue(rows),
					readByQuery: vi.fn().mockResolvedValue(rows),
				},
			},
		});
		const { reg } = register({
			services,
			env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' },
		});
		await reg.actions['email_templates.items.update']!({ keys: ['1', '2'] });
		// Once per unique language (2)
		expect(fsMocks.writeFile).toHaveBeenCalledTimes(2);
	});

	it('logs when update resync throws', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readMany: vi.fn().mockRejectedValue(new Error('boom')),
				},
			},
		});
		const { logger, reg } = register({
			services,
			env: { EMAIL_TEMPLATES_PATH: '/tmp/tpl' },
		});
		await reg.actions['email_templates.items.update']!({ keys: ['1'] });
		expect(logger.error).toHaveBeenCalled();
	});
});

describe('template items.create filter (checksum)', () => {
	it('writes a checksum into the payload', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.create']!({
			template_key: 'x',
			language: 'en',
			subject: 'S',
			from_name: null,
			strings: { a: 'b' },
		});
		expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
	});

	it('tolerates missing subject / from_name / strings by defaulting them', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.create']!({ template_key: 'x' });
		expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe('template items.update filter (checksum)', () => {
	it('skips recompute when the patch does not touch checksummed fields', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		const patch = { description: 'x' } as any;
		const out = await reg.filters['email_templates.items.update']!(patch, { keys: ['1'] });
		expect(out.checksum).toBeUndefined();
	});

	it('skips recompute when a bulk update is performed', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!(
			{ subject: 'new' },
			{ keys: ['1', '2'] },
		);
		expect(out.checksum).toBeUndefined();
	});

	it('recomputes using existing row fields for any missing keys', async () => {
		const existing = {
			subject: 'old',
			from_name: 'org',
			strings: { a: '1' },
		};
		const { services } = makeServices({
			items: {
				email_templates: { readOne: vi.fn().mockResolvedValue(existing) },
			},
		});
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!(
			{ subject: 'new' },
			{ keys: ['1'] },
		);
		expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
	});

	it('recomputes when only from_name is patched', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readOne: vi.fn().mockResolvedValue({
						subject: 's',
						from_name: 'o',
						strings: {},
					}),
				},
			},
		});
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!(
			{ from_name: 'x' },
			{ keys: ['1'] },
		);
		expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
	});

	it('recomputes with null existing strings when patch omits strings', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readOne: vi.fn().mockResolvedValue({
						subject: 's',
						from_name: 'o',
						strings: null,
					}),
				},
			},
		});
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!(
			{ from_name: 'x' },
			{ keys: ['1'] },
		);
		expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
	});

	it('recomputes when only strings is patched, even with null existing', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readOne: vi.fn().mockResolvedValue({
						subject: null,
						from_name: null,
						strings: null,
					}),
				},
			},
		});
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!(
			{ strings: { a: 'b' } },
			{ keys: ['1'] },
		);
		expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
	});

	it('skips recompute when meta has no keys at all', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!({ subject: 'new' }, {});
		expect(out.checksum).toBeUndefined();
	});

	it('warns but returns the patch untouched when checksum recompute throws', async () => {
		const { services } = makeServices({
			items: {
				email_templates: { readOne: vi.fn().mockRejectedValue(new Error('no row')) },
			},
		});
		const { logger, reg } = register({ services });
		const out = await reg.filters['email_templates.items.update']!(
			{ subject: 'new' },
			{ keys: ['1'] },
		);
		expect(out).toEqual({ subject: 'new' });
		expect(logger.warn).toHaveBeenCalled();
	});
});

describe('template items.delete filter (protected guard)', () => {
	it('passes through an empty payload', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		await reg.filters['email_templates.items.delete']!([]);
	});

	it('passes through an undefined payload', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		await reg.filters['email_templates.items.delete']!(undefined);
	});

	it('throws when any row is protected', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readMany: vi.fn().mockResolvedValue([
						{ template_key: 'x', is_protected: false },
						{ template_key: 'base', is_protected: true },
					]),
				},
			},
		});
		const { reg } = register({ services });
		await expect(reg.filters['email_templates.items.delete']!(['1', '2'])).rejects.toThrow(
			/protected template/i,
		);
	});

	it('passes through when no row is protected', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readMany: vi
						.fn()
						.mockResolvedValue([{ template_key: 'x', is_protected: false }]),
				},
			},
		});
		const { reg } = register({ services });
		const payload = ['1'];
		const out = await reg.filters['email_templates.items.delete']!(payload);
		expect(out).toBe(payload);
	});
});

describe('variables items.delete filter (protected guard)', () => {
	it('passes through an empty payload', async () => {
		const { services } = makeServices();
		const { reg } = register({ services });
		await reg.filters['email_template_variables.items.delete']!(undefined);
	});

	it('throws when any variable row is protected', async () => {
		const { services } = makeServices({
			items: {
				email_template_variables: {
					readMany: vi
						.fn()
						.mockResolvedValue([
							{ template_key: 'base', variable_name: 'url', is_protected: true },
						]),
				},
			},
		});
		const { reg } = register({ services });
		await expect(reg.filters['email_template_variables.items.delete']!(['1'])).rejects.toThrow(
			/protected variable/i,
		);
	});

	it('passes through when no variable row is protected', async () => {
		const { services } = makeServices({
			items: {
				email_template_variables: {
					readMany: vi
						.fn()
						.mockResolvedValue([
							{ template_key: 'x', variable_name: 'url', is_protected: false },
						]),
				},
			},
		});
		const { reg } = register({ services });
		const payload = ['1'];
		const out = await reg.filters['email_template_variables.items.delete']!(payload);
		expect(out).toBe(payload);
	});
});

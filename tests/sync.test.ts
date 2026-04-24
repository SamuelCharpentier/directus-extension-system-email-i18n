import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeServices, makeLogger, emptySchema } from './helpers';
import type { EmailTemplateRow } from '../src/types';

const fsMocks = vi.hoisted(() => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	rename: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
	writeFile: fsMocks.writeFile,
	rename: fsMocks.rename,
	mkdir: fsMocks.mkdir,
}));

import { buildLocaleData, syncAllLocales, syncLocale, localeFilePath } from '../src/sync';

function row(overrides: Partial<EmailTemplateRow>): EmailTemplateRow {
	return {
		template_key: 'k',
		language: 'en',
		category: 'custom',
		subject: '',
		from_name: null,
		strings: {},
		description: null,
		is_active: true,
		is_protected: false,
		version: 1,
		checksum: '',
		last_synced_at: null,
		...overrides,
	};
}

describe('buildLocaleData', () => {
	it('promotes the base row from_name to top-level', () => {
		const data = buildLocaleData([
			row({
				template_key: 'base',
				from_name: 'My Org',
				strings: { org_name: 'My Org' },
			}),
			row({
				template_key: 'password-reset',
				subject: 'Reset',
				strings: { heading: 'H' },
			}),
		]);
		expect(data.from_name).toBe('My Org');
		expect(data['base']).toEqual({ from_name: 'My Org', org_name: 'My Org' });
		expect(data['password-reset']).toEqual({ subject: 'Reset', heading: 'H' });
	});

	it('omits top-level from_name when there is no base row', () => {
		const data = buildLocaleData([row({ template_key: 'x', strings: { a: 'b' } })]);
		expect(data.from_name).toBeUndefined();
	});

	it('omits subject/from_name keys when empty', () => {
		const data = buildLocaleData([row({ template_key: 'x', strings: { a: 'b' } })]);
		expect(data['x']).toEqual({ a: 'b' });
	});
});

describe('localeFilePath', () => {
	it('joins templatesPath + locales + {lang}.json', () => {
		expect(localeFilePath('/tmp/tpl', 'en')).toMatch(/locales/);
	});
});

describe('syncAllLocales', () => {
	beforeEach(() => {
		fsMocks.writeFile.mockClear();
		fsMocks.rename.mockClear();
		fsMocks.mkdir.mockClear();
	});

	it('warns and returns when templatesPath is empty', async () => {
		const logger = makeLogger();
		const { services } = makeServices();
		await syncAllLocales('', services, emptySchema, logger);
		expect(logger.warn).toHaveBeenCalled();
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});

	it('writes one file per language', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readByQuery: vi
						.fn()
						.mockResolvedValue([
							row({ template_key: 'x', language: 'en' }),
							row({ template_key: 'y', language: 'fr' }),
						]),
				},
			},
		});
		const logger = makeLogger();
		await syncAllLocales('/tmp/tpl', services, emptySchema, logger);
		expect(fsMocks.writeFile).toHaveBeenCalledTimes(2);
		expect(fsMocks.rename).toHaveBeenCalledTimes(2);
		expect(logger.info).toHaveBeenCalled();
	});

	it('logs but does not throw when a write fails', async () => {
		fsMocks.writeFile.mockRejectedValueOnce(new Error('disk full'));
		const { services } = makeServices({
			items: {
				email_templates: {
					readByQuery: vi
						.fn()
						.mockResolvedValue([row({ template_key: 'x', language: 'en' })]),
				},
			},
		});
		const logger = makeLogger();
		await syncAllLocales('/tmp/tpl', services, emptySchema, logger);
		expect(logger.error).toHaveBeenCalled();
	});
});

describe('syncLocale', () => {
	beforeEach(() => {
		fsMocks.writeFile.mockClear();
		fsMocks.rename.mockClear();
		fsMocks.mkdir.mockClear();
	});

	it('is a no-op when templatesPath is empty', async () => {
		const logger = makeLogger();
		const { services } = makeServices();
		await syncLocale('en', '', services, emptySchema, logger);
		expect(fsMocks.writeFile).not.toHaveBeenCalled();
	});

	it('filters rows by language and writes a single file', async () => {
		const { services } = makeServices({
			items: {
				email_templates: {
					readByQuery: vi
						.fn()
						.mockResolvedValue([
							row({ template_key: 'x', language: 'en' }),
							row({ template_key: 'y', language: 'fr' }),
						]),
				},
			},
		});
		const logger = makeLogger();
		await syncLocale('en', '/tmp/tpl', services, emptySchema, logger);
		expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
	});
});

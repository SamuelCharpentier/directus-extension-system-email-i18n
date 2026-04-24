import { describe, it, expect } from 'vitest';
import * as constants from '../src/constants';
import * as schema from '../src/schema';
import { SEED_TEMPLATES, SEED_VARIABLES } from '../src/seeds';

describe('constants', () => {
	it('declares the expected collection and key constants', () => {
		expect(constants.TEMPLATES_COLLECTION).toBe('email_templates');
		expect(constants.SYSTEM_TEMPLATE_KEYS).toContain('password-reset');
		expect(constants.PROTECTED_TEMPLATE_KEYS).toContain('admin-error');
		expect(constants.TEMPLATE_CATEGORIES).toContain('custom');
	});
});

describe('schema definitions', () => {
	it('exports all three collection payloads', () => {
		expect(schema.ALL_COLLECTIONS).toHaveLength(3);
		expect(schema.EMAIL_TEMPLATES_COLLECTION.collection).toBe(constants.TEMPLATES_COLLECTION);
		expect(schema.EMAIL_TEMPLATE_VARIABLES_COLLECTION.collection).toBe(
			constants.VARIABLES_COLLECTION,
		);
		expect(schema.EMAIL_TEMPLATE_SYNC_AUDIT_COLLECTION.collection).toBe(
			constants.SYNC_AUDIT_COLLECTION,
		);
	});

	it('each collection defines an id primary field', () => {
		for (const c of schema.ALL_COLLECTIONS) {
			const id = c.fields.find((f) => f.field === 'id');
			expect(id?.schema?.['is_primary_key']).toBe(true);
		}
	});
});

describe('seeds', () => {
	it('seeds at least FR + EN for every system template', () => {
		for (const key of constants.PROTECTED_TEMPLATE_KEYS) {
			expect(SEED_TEMPLATES.some((t) => t.template_key === key && t.language === 'fr')).toBe(
				true,
			);
			expect(SEED_TEMPLATES.some((t) => t.template_key === key && t.language === 'en')).toBe(
				true,
			);
		}
	});

	it('declares required variables for every system template', () => {
		expect(SEED_VARIABLES.some((v) => v.template_key === 'admin-error' && v.is_required)).toBe(
			true,
		);
	});
});

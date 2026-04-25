import type { ExtensionsServices, SchemaOverview } from '@directus/types';
import { fetchTemplateVariables } from './directus';

export type ValidationResult = { ok: true } | { ok: false; missing: string[] };

/**
 * Validate that every required variable for the given template_key is
 * present in the caller's template.data payload.
 */
export async function validateRequiredVariables(
	templateKey: string,
	data: Record<string, unknown>,
	services: ExtensionsServices,
	schema: SchemaOverview,
): Promise<ValidationResult> {
	const registry = await fetchTemplateVariables(templateKey, services, schema);
	const missing = registry
		.filter((r) => r.is_required === true)
		.map((r) => r.variable_name)
		.filter((name) => !(name in data));
	if (missing.length === 0) return { ok: true };
	return { ok: false, missing };
}

import { describe, it, expect } from 'vitest';
import { computeChecksum, checksumMatches } from '../src/integrity';

describe('computeChecksum', () => {
	it('is deterministic and independent of key order', () => {
		const a = computeChecksum({
			subject: 'Hi',
			from_name: 'Org',
			strings: { a: '1', b: '2', c: '3' },
		});
		const b = computeChecksum({
			subject: 'Hi',
			from_name: 'Org',
			strings: { c: '3', b: '2', a: '1' },
		});
		expect(a).toBe(b);
		expect(a).toHaveLength(64);
	});

	it('differs when any part of the payload changes', () => {
		const base = computeChecksum({ subject: 'A', from_name: null, strings: { x: '1' } });
		expect(base).not.toBe(
			computeChecksum({ subject: 'B', from_name: null, strings: { x: '1' } }),
		);
		expect(base).not.toBe(
			computeChecksum({ subject: 'A', from_name: 'n', strings: { x: '1' } }),
		);
		expect(base).not.toBe(
			computeChecksum({ subject: 'A', from_name: null, strings: { x: '2' } }),
		);
	});

	it('accepts an empty strings map', () => {
		expect(computeChecksum({ subject: '', from_name: null, strings: {} })).toHaveLength(64);
	});
});

describe('checksumMatches', () => {
	it('returns false when either value is missing', () => {
		expect(checksumMatches(null, 'x')).toBe(false);
		expect(checksumMatches('x', null)).toBe(false);
		expect(checksumMatches(undefined, undefined)).toBe(false);
		expect(checksumMatches('', 'x')).toBe(false);
	});

	it('returns true when checksums are equal', () => {
		expect(checksumMatches('abc', 'abc')).toBe(true);
		expect(checksumMatches('abc', 'abd')).toBe(false);
	});
});

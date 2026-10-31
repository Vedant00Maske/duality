import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM tooling module without type declarations
import { auditCharacterSheet } from '../../tools/asset-audit.mjs';

describe('character sprite sheets match the spec', () => {
  for (const name of ['ember', 'tide']) {
    it(`${name} sheet passes the asset audit`, () => {
      const { errors } = auditCharacterSheet(name) as { errors: string[] };
      expect(errors).toEqual([]);
    });
  }
});

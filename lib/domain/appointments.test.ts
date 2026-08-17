/**
 * The gate on appointing a carrier is the Incoterm, not a permission.
 *
 * Get the SIDE wrong and a desk books a leg the counterparty already paid for —
 * a real double-charge, and one that looks like diligence while it happens.
 * These tests exist because that mistake is invisible until an invoice arrives.
 */

import { describe, expect, it } from 'vitest';
import { appointableLegs, legAppointability, activeLogisticsPartners } from './appointments';

describe('the inbound leg reads the term we BOUGHT on', () => {
  it('is ours on EXW and FOB, where the buyer books the main carriage', () => {
    expect(legAppointability('IMPORT', 'EXW', 'DDP').ours).toBe(true);
    expect(legAppointability('IMPORT', 'FOB', 'DDP').ours).toBe(true);
  });

  it('is NOT ours on CIF or DAP, where the supplier already bought the freight', () => {
    expect(legAppointability('IMPORT', 'CIF', 'DDP').ours).toBe(false);
    expect(legAppointability('IMPORT', 'DAP', 'DDP').ours).toBe(false);
  });

  it('says why, in the term’s own words, so the refusal is arguable', () => {
    const r = legAppointability('IMPORT', 'CIF', 'DDP');
    expect(r.reason).toMatch(/CIF/);
    expect(r.reason).toMatch(/already covered/i);
  });
});

describe('the outbound leg reads the term we SOLD on, where the roles invert', () => {
  it('is ours on DDP and CIF, where the seller carries to the customer', () => {
    expect(legAppointability('OUTBOUND', 'FOB', 'DDP').ours).toBe(true);
    expect(legAppointability('OUTBOUND', 'FOB', 'CIF').ours).toBe(true);
  });

  it('is NOT ours on EXW, where the customer collects', () => {
    expect(legAppointability('OUTBOUND', 'FOB', 'EXW').ours).toBe(false);
  });

  it('does not let the BUY term decide the outbound leg', () => {
    // Same sell term, opposite buy terms — the answer must not move.
    const a = legAppointability('OUTBOUND', 'EXW', 'DDP').ours;
    const b = legAppointability('OUTBOUND', 'DDP', 'DDP').ours;
    expect(a).toBe(b);
  });
});

describe('the testing legs sit outside the sale contract', () => {
  it('is always ours, whatever the terms say', () => {
    for (const buy of ['EXW', 'FOB', 'CIF', 'DDP']) {
      expect(legAppointability('TEST_OUT', buy, 'DDP').ours).toBe(true);
      expect(legAppointability('TEST_RETURN', buy, 'EXW').ours).toBe(true);
    }
  });
});

describe('missing terms refuse rather than assume', () => {
  it('refuses the inbound leg when no buy term is recorded', () => {
    expect(legAppointability('IMPORT', '', 'DDP').ours).toBe(false);
  });

  it('refuses the outbound leg when no sell term is recorded', () => {
    expect(legAppointability('OUTBOUND', 'FOB', null).ours).toBe(false);
  });
});

describe('desks and partners', () => {
  it('gives each logistics desk only its own legs, and other desks none', () => {
    expect(appointableLegs('ONE_BUY_INBOUND')).toEqual(['IMPORT', 'TEST_OUT', 'TEST_RETURN']);
    expect(appointableLegs('ONE_BUY_OUTBOUND')).toEqual(['OUTBOUND']);
    expect(appointableLegs('ONE_BUY_FINANCE')).toEqual([]);
  });

  it('offers at least one bookable carrier', () => {
    expect(activeLogisticsPartners().length).toBeGreaterThan(0);
    expect(activeLogisticsPartners()[0].services.length).toBeGreaterThan(0);
  });
});

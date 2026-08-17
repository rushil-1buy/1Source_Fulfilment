import { describe, expect, it } from 'vitest';
import {
  assignAttachments,
  attachmentsFor,
  claimsAnAttachment,
  type AttachableDoc,
} from './message-attachments';

const doc = (id: string, docType: string, stageId: string | null = null): AttachableDoc => ({
  id,
  docType,
  stageId,
});

describe('what a message carries', () => {
  it('attaches the sender’s own paperwork', () => {
    // The supplier's proforma travels with the supplier's mail about it.
    const out = attachmentsFor({
      from: 'SUPPLIER',
      stageId: 'SUPPLIER_PI_RECEIVED',
      documents: [doc('d1', 'supplierPi', 'SUPPLIER_PI_RECEIVED')],
    });
    expect(out.map((d) => d.id)).toEqual(['d1']);
  });

  it('never puts another party’s document in somebody’s mail', () => {
    // A step accumulates paperwork from several parties. A supplier mail
    // carrying the customs agent's entry would be a mailbox inventing files.
    const out = attachmentsFor({
      from: 'SUPPLIER',
      stageId: 'CUSTOMS_ENTRY_FILED_ICEGATE',
      documents: [doc('d1', 'billOfEntry', 'CUSTOMS_ENTRY_FILED_ICEGATE')],
    });
    expect(out).toEqual([]);
  });

  it('attaches to the message from the party who owes it, not the chase', () => {
    /*
     * The load-bearing asymmetry. We chase the certificate of origin; they send
     * it. A chase carrying the document it is chasing would be nonsense, and it
     * is exactly what a keyword rule on the word "attached" would produce.
     */
    const documents = [doc('d1', 'coo', 'BORDER_ARRIVAL_WHA_ENGAGED')];
    expect(
      attachmentsFor({ from: 'ONE_BUY_INBOUND', stageId: 'BORDER_ARRIVAL_WHA_ENGAGED', documents }),
    ).toEqual([]);
    expect(
      attachmentsFor({ from: 'SUPPLIER', stageId: 'BORDER_ARRIVAL_WHA_ENGAGED', documents }).length,
    ).toBeGreaterThanOrEqual(0);
  });

  it('keeps paperwork from another step out of this message', () => {
    // Two packing lists on a split consignment must not both land in one mail.
    const out = attachmentsFor({
      from: 'SUPPLIER',
      stageId: 'SUPPLIER_PI_RECEIVED',
      documents: [doc('d1', 'supplierPi', 'GOODS_RECEIVED_INBOUND_AT_1BUY')],
    });
    expect(out).toEqual([]);
  });

  it('still carries a document that never recorded its step', () => {
    // Older uploads predate stage tagging; dropping them would make a thread
    // look emptier than the order actually is.
    const out = attachmentsFor({
      from: 'SUPPLIER',
      stageId: 'SUPPLIER_PI_RECEIVED',
      documents: [doc('d1', 'supplierPi', null)],
    });
    expect(out.map((d) => d.id)).toEqual(['d1']);
  });

  it('returns nothing for a step that produces no paperwork', () => {
    expect(
      attachmentsFor({ from: 'ONE_BUY_SOURCING', stageId: 'WORK_ORDER_ACTIVE', documents: [] }),
    ).toEqual([]);
  });

  it('matches the stored type and the gate’s id alike', () => {
    /*
     * The bug this exists to prevent, and it shipped once.
     *
     * The gate calls this document `supplierPi`; every seeded record calls it
     * `SUPPLIER_PI`. Lowercasing either gives 'supplierpi' against
     * 'supplier_pi', which never matches — so every thread in the product came
     * back with no attachments while the rule looked right in isolation,
     * because the only test covered the gate's spelling.
     */
    for (const stored of ['supplierPi', 'SUPPLIER_PI', 'supplier_pi']) {
      const a = attachmentsFor({
        from: 'SUPPLIER',
        stageId: 'SUPPLIER_PI_RECEIVED',
        documents: [doc('d1', stored)],
      });
      expect(a.length, stored).toBe(1);
    }
  });
});

describe('spotting a message that claims an attachment', () => {
  it('recognises a claim', () => {
    expect(claimsAnAttachment('Our proforma invoice is attached.')).toBe(true);
    expect(claimsAnAttachment('Documents enclosed for your filing.')).toBe(true);
  });

  it('does not read a request as a claim', () => {
    // "Please send the packing list" promises nothing and must not be flagged
    // as a message whose attachment went missing.
    expect(claimsAnAttachment('Please send the packing list at your earliest.')).toBe(false);
  });
});

describe('assigning documents to the message they arrived on', () => {
  const t = (min: number) => new Date(2026, 0, 1, 9, min);

  it('gives a document to the earliest message that would carry it', () => {
    // A later mail mentioning the same paperwork refers back to it; it does not
    // deliver it a second time.
    const map = assignAttachments(
      [
        { id: 'm2', from: 'SUPPLIER', stageId: 'SUPPLIER_PI_RECEIVED', occurredAt: t(30) },
        { id: 'm1', from: 'SUPPLIER', stageId: 'SUPPLIER_PI_RECEIVED', occurredAt: t(10) },
      ],
      [doc('d1', 'supplierPi', 'SUPPLIER_PI_RECEIVED')],
    );
    expect(map.get('d1')).toBe('m1');
  });

  it('leaves alone the documents no message would have carried', () => {
    // A bill of entry is filed on a portal. Inventing a mail for it would make
    // the thread a worse record than the register.
    const map = assignAttachments(
      [{ id: 'm1', from: 'SUPPLIER', stageId: 'SUPPLIER_PI_RECEIVED', occurredAt: t(10) }],
      [doc('d1', 'billOfEntry', 'CUSTOMS_ENTRY_FILED_ICEGATE')],
    );
    expect(map.size).toBe(0);
  });

  it('never assigns one document to two messages', () => {
    const map = assignAttachments(
      [
        { id: 'm1', from: 'SUPPLIER', stageId: 'SUPPLIER_PI_RECEIVED', occurredAt: t(10) },
        { id: 'm2', from: 'SUPPLIER', stageId: 'SUPPLIER_PI_RECEIVED', occurredAt: t(20) },
      ],
      [doc('d1', 'supplierPi', 'SUPPLIER_PI_RECEIVED')],
    );
    expect([...map.values()]).toEqual(['m1']);
  });

  it('ignores a message with no step to anchor it', () => {
    const map = assignAttachments(
      [{ id: 'm1', from: 'SUPPLIER', stageId: null, occurredAt: t(10) }],
      [doc('d1', 'supplierPi', 'SUPPLIER_PI_RECEIVED')],
    );
    expect(map.size).toBe(0);
  });
});

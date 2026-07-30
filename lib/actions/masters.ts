'use server';

/**
 * Adding an entry to a reference directory.
 *
 * One entry point for all six directories. The fields come from
 * lib/domain/master-forms.ts, so the form and this writer are driven by the same
 * declaration and cannot drift; what is enforced *here* is what the form cannot
 * know — uniqueness, tax-registration validity, and the split of a total tax
 * rate into its component parts.
 */

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { masterForm } from '@/lib/domain/master-forms';
import { toMinor } from '@/lib/domain/money';
import { validateGstin } from '@/lib/tax/gst-engine';

export interface MasterResult {
  ok: boolean;
  message: string;
  detail?: string;
  errors?: Record<string, string>;
}

type Values = Record<string, string | number | boolean | null | undefined>;

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    /* not in a request context */
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 'on';

export async function createMasterRecord(type: string, values: Values): Promise<MasterResult> {
  const def = masterForm(type);
  if (!def) return { ok: false, message: 'That directory cannot be added to.' };

  // Required fields, straight from the declaration.
  const errors: Record<string, string> = {};
  for (const f of def.fields) {
    if (!f.required) continue;
    const v = values[f.key];
    if (v === undefined || v === null || String(v).trim() === '') {
      errors[f.key] = `${f.label} is needed.`;
    }
  }
  if (Object.keys(errors).length) {
    return { ok: false, message: `That ${def.noun} could not be saved.`, errors };
  }

  try {
    switch (type) {
      case 'customers': {
        const gstin = str(values.gstin).toUpperCase();
        const stateCode = str(values.stateCode);
        // A wrong registration number produces wrong tax on every future
        // invoice, so it is checked at the point of entry, not at invoicing.
        if (gstin) {
          const check = validateGstin(gstin);
          if (!check.valid) {
            return {
              ok: false,
              message: 'That tax registration number is not valid.',
              detail: `${check.errors.join(' ')} Leave it blank if you do not have it yet.`,
              errors: { gstin: check.errors[0] ?? 'Not a valid number.' },
            };
          }
          // The first two characters of the number ARE the state. If they
          // disagree with the state chosen, one of the two is wrong, and either
          // way the invoice would be taxed incorrectly.
          if (check.stateCode && check.stateCode !== stateCode) {
            return {
              ok: false,
              message: 'The registration number and the state do not agree.',
              detail: `The number begins ${check.stateCode}, which is ${stateNameFor(check.stateCode)}, but the state selected is ${stateNameFor(stateCode)}. Correct whichever is wrong — this decides how every invoice to them is taxed.`,
              errors: { stateCode: `The number says ${stateNameFor(check.stateCode)}.` },
            };
          }
        }
        const created = await db.customer.create({
          data: {
            code: str(values.code).toUpperCase(),
            name: str(values.name),
            gstin: gstin || null,
            stateCode,
            stateName: stateNameFor(stateCode),
            addressLine1: str(values.addressLine1),
            city: str(values.city),
            pincode: str(values.pincode),
            country: 'India',
            isSez: bool(values.isSez),
            isExport: bool(values.isExport),
            contactName: str(values.contactName),
            contactEmail: str(values.contactEmail),
            contactPhone: str(values.contactPhone) || null,
            paymentTerms: str(values.paymentTerms) || '30 days',
            creditLimit: toMinor(num(values.creditLimit)),
          },
        });
        await auditCreate('Customer', created.id, 'Customer added', `${created.code} · ${created.name} · ${created.stateName}${created.gstin ? ` · ${created.gstin}` : ''}`);
        return done(def.noun, created.name, 'customer');
      }

      case 'suppliers': {
        const gstin = str(values.gstin).toUpperCase();
        if (gstin) {
          const check = validateGstin(gstin);
          if (!check.valid) {
            return {
              ok: false,
              message: 'That tax registration number is not valid.',
              detail: `${check.errors.join(' ')} Leave it blank for an overseas supplier.`,
              errors: { gstin: check.errors[0] ?? 'Not a valid number.' },
            };
          }
        }
        const created = await db.supplier.create({
          data: {
            code: str(values.code).toUpperCase(),
            name: str(values.name),
            isForeign: bool(values.isForeign),
            gstin: gstin || null,
            addressLine1: str(values.addressLine1),
            city: str(values.city),
            postcode: str(values.postcode) || null,
            country: str(values.country) || 'India',
            contactName: str(values.contactName),
            contactEmail: str(values.contactEmail),
            contactPhone: str(values.contactPhone) || null,
            contactFax: str(values.contactFax) || null,
            currency: str(values.currency) || 'USD',
            incoterms: str(values.incoterms) || 'FOB',
            bankName: str(values.bankName) || null,
            bankAddress: str(values.bankAddress) || null,
            bankAccount: str(values.bankAccount) || null,
            swiftCode: str(values.swiftCode).toUpperCase() || null,
            beneficiaryName: str(values.name),
            bankFeeNote: bool(values.isForeign)
              ? 'Sender pays India bank fees; beneficiary pays overseas bank fees.'
              : 'Each party bears its own bank charges.',
          },
        });
        await auditCreate('Supplier', created.id, 'Supplier added', `${created.code} · ${created.name} · ${created.country} · ${created.currency}`);
        return {
          ...done(def.noun, created.name, 'supplier'),
          detail:
            'Saved. A supplier must also be approved on the Approved Vendor List before an order can be placed with them.',
        };
      }

      case 'rates': {
        const total = num(values.gstRate);
        if (total < 0 || total > 40) {
          return {
            ok: false,
            message: 'That rate looks wrong.',
            errors: { gstRate: 'Enter the total rate as a percentage, between 0 and 40.' },
          };
        }
        const from = new Date(str(values.effectiveFrom));
        const to = str(values.effectiveTo) ? new Date(str(values.effectiveTo)) : null;
        if (to && to < from) {
          return {
            ok: false,
            message: 'Those dates are the wrong way round.',
            errors: { effectiveTo: 'The end date cannot be before the start date.' },
          };
        }
        const hsnCode = str(values.hsnCode);
        // Within one state the total splits in half; across states the whole
        // rate is charged as integrated tax. Storing all three keeps the engine
        // free of arithmetic at invoicing time.
        const created = await db.hsnRate.create({
          data: {
            hsnCode,
            description: str(values.description),
            cgstRate: total / 2,
            sgstRate: total / 2,
            igstRate: total,
            cessRate: num(values.cessRate),
            effectiveFrom: from,
            effectiveTo: to,
          },
        });
        await auditCreate('Tax rate', created.id, `Rate for ${created.hsnCode}`, `${total}% total (${total / 2}% central + ${total / 2}% state, ${total}% integrated), in force from ${from.toISOString().slice(0, 10)}`);
        return {
          ok: true,
          message: `Tax rate added for ${created.hsnCode}.`,
          detail: `${total}% total — ${total / 2}% central and ${total / 2}% state within one state, ${total}% integrated across states. In force from ${from.toDateString()}.`,
        };
      }

      case 'labs': {
        const accreditations = str(values.accreditations);
        const created = await db.testingLab.create({
          data: {
            code: str(values.code).toUpperCase(),
            name: str(values.name),
            isForeign: bool(values.isForeign),
            gstin: str(values.gstin).toUpperCase() || null,
            country: str(values.country) || 'India',
            addressLine1: str(values.addressLine1) || null,
            city: str(values.city) || null,
            contactEmail: str(values.contactEmail) || null,
            accreditations: accreditations
              ? JSON.stringify(
                  accreditations
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean),
                )
              : null,
          },
        });
        await auditCreate('Testing laboratory', created.id, 'Laboratory added', `${created.code} · ${created.name} · ${created.country}`);
        return done(def.noun, created.name, 'testing laboratory');
      }

      case 'carriers': {
        const created = await db.carrier.create({
          data: {
            code: str(values.code).toUpperCase(),
            name: str(values.name),
            isIntegrated: bool(values.isIntegrated),
            supportsPod: values.supportsPod === undefined ? true : bool(values.supportsPod),
          },
        });
        await auditCreate('Carrier', created.id, 'Carrier added', `${created.code} · ${created.name}`);
        return done(def.noun, created.name, 'carrier');
      }

      case 'parameters': {
        const created = await db.testParameterMaster.create({
          data: {
            code: str(values.code).toUpperCase(),
            name: str(values.name),
            category: str(values.category),
            method: str(values.method) || null,
            unit: str(values.unit) || null,
            isDefault: bool(values.isDefault),
          },
        });
        await auditCreate('Test parameter', created.id, 'Parameter added', `${created.code} · ${created.name} · ${created.category}`);
        return done(def.noun, created.name, 'test parameter');
      }

      default:
        return { ok: false, message: 'That directory cannot be added to.' };
    }
  } catch (err) {
    // The commonest failure by far is a code that is already taken.
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique constraint/i.test(msg)) {
      return {
        ok: false,
        message: 'That code is already in use.',
        detail: 'Codes have to be unique. Pick another and try again.',
        errors: { code: 'Already used by another entry.' },
      };
    }
    return { ok: false, message: `That ${def.noun} could not be saved.`, detail: msg };
  } finally {
    safeRevalidate('/masters');
  }
}

/**
 * Every directory addition lands on the audit log. A reference record silently
 * appearing is exactly the kind of change that is impossible to explain later —
 * a wrong tax rate or an unapproved supplier has to be traceable to whoever
 * added it.
 */
async function auditCreate(entity: string, id: string, label: string, detail: string) {
  await db.auditLogEntry.create({
    data: {
      entity,
      entityId: id,
      action: 'CREATE',
      field: label,
      afterValue: detail,
      actorId: 'u-priya',
      actorLabel: 'Akash Dwivedi',
    },
  });
}

function done(noun: string, name: string, what: string): MasterResult {
  return { ok: true, message: `${capitalise(noun)} added.`, detail: `${name} is now on the ${what} directory and can be selected on an order.` };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The state names matching the codes offered by the form. */
const STATE_NAMES: Record<string, string> = {
  '03': 'Punjab',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '19': 'West Bengal',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
};

function stateNameFor(code: string): string {
  return STATE_NAMES[code] ?? 'Unknown';
}

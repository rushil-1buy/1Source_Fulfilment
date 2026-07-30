/**
 * The pieces every printed document is built from.
 *
 * Server components on purpose — a printed page has no interactivity, and
 * keeping them off the client means the sheet renders in one pass with no
 * hydration flash before someone hits Print.
 *
 * Styling lives in app/(print)/document.css as plain classes in points. See the
 * header of that file for why these deliberately avoid the design tokens.
 */

import type { PrintLine, PrintParty } from '@/lib/queries/print';
import { formatMoney } from '@/lib/domain/money';

/** dd-MMM-yy, the form Indian commercial vouchers use. */
export function voucherDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const m = date.toLocaleString('en-GB', { month: 'short' });
  return `${String(date.getDate()).padStart(2, '0')}-${m}-${String(date.getFullYear()).slice(2)}`;
}

/** "Jul 26, 2026" — the longer form used on the proforma invoice. */
export function longDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Money digits only — the column head or an adjacent cell carries the currency. */
function bare(minor: number, currency: string): string {
  return formatMoney(minor, currency, { withCode: false, withSymbol: false });
}

// ── Sheet ──────────────────────────────────────────────────────────────────

export function DocSheet({ children }: { children: React.ReactNode }) {
  return <div className="doc-sheet">{children}</div>;
}

export function DocTitle({ children, ruled }: { children: React.ReactNode; ruled?: boolean }) {
  return <h1 className={`doc-title${ruled ? ' doc-title-ruled' : ''}`}>{children}</h1>;
}

export function Letterhead({ party }: { party: PrintParty }) {
  const contact = [
    party.phone ? `Tel: ${party.phone}` : null,
    party.fax ? `Fax: ${party.fax}` : null,
  ].filter(Boolean);
  return (
    <header className="doc-letterhead">
      <div className="doc-letterhead-name">{party.name}</div>
      <div className="doc-letterhead-addr">{party.lines.join(', ')}</div>
      {contact.length > 0 && (
        <div className="doc-letterhead-contact">{contact.join('  ·  ')}</div>
      )}
    </header>
  );
}

// ── Party blocks ───────────────────────────────────────────────────────────

export function PartyBlock({
  label,
  party,
  showIdentifiers = true,
}: {
  label: string;
  party: PrintParty;
  showIdentifiers?: boolean;
}) {
  return (
    <>
      <div className="doc-field-label">{label}</div>
      <div className="doc-party-name">{party.name}</div>
      {party.lines.map((l, i) => (
        <div key={i} className="doc-party-line">
          {l}
        </div>
      ))}
      {showIdentifiers && (
        <>
          {party.cin && <div className="doc-party-line">Corporate Identity Number: {party.cin}</div>}
          {party.gstin && (
            <div className="doc-party-line">
              Goods and Services Tax Identification Number: {party.gstin}
            </div>
          )}
          {party.stateName && <div className="doc-party-line">State Name: {party.stateName}</div>}
        </>
      )}
    </>
  );
}

// ── Voucher header field ───────────────────────────────────────────────────

export function VoucherField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="doc-field-label">{label}</div>
      <div className="doc-field-value">{children}</div>
    </>
  );
}

// ── Ladder (proforma invoice) ──────────────────────────────────────────────

export interface LadderItem {
  label: string;
  /** Rendered right-aligned and bold on one line. */
  value?: React.ReactNode;
  /** Rendered as a left-aligned block under the label instead. */
  block?: React.ReactNode;
}

export function Ladder({ items }: { items: LadderItem[] }) {
  return (
    <table className="doc-ladder">
      <tbody>
        {items.map((it, i) => (
          <tr key={i} className={it.block ? 'doc-ladder-block' : undefined}>
            <th scope="row">{it.label}</th>
            <td>{it.block ?? it.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The multi-line party form used inside a ladder row. */
export function LadderParty({ party }: { party: PrintParty }) {
  return (
    <>
      <div className="doc-party-name">{party.name}</div>
      {party.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {party.cin && <div>Corporate Identity Number: {party.cin}</div>}
      {party.gstin && <div>Goods and Services Tax Identification Number: {party.gstin}</div>}
      {party.phone && <div>Tel: {party.phone}</div>}
      {party.email && <div>E-Mail: {party.email}</div>}
    </>
  );
}

// ── Goods tables ───────────────────────────────────────────────────────────

/**
 * The Tally goods table: Sl No. · Description of Goods · Quantity · Rate · per ·
 * Amount, with the traditional open space under the lines before the total.
 */
export function VoucherGoodsTable({
  lines,
  currency,
  totalQuantity,
  totalUom,
  totalValue,
  filler = true,
}: {
  lines: PrintLine[];
  currency: string;
  totalQuantity: number;
  totalUom: string;
  totalValue: number;
  filler?: boolean;
}) {
  return (
    <table className="doc-goods">
      <thead>
        <tr>
          <th style={{ width: '8%' }}>Sl No.</th>
          <th>Description of Goods</th>
          <th style={{ width: '17%' }}>Quantity</th>
          <th style={{ width: '13%' }}>Rate</th>
          <th style={{ width: '9%' }}>per</th>
          <th style={{ width: '18%' }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.lineNo}>
            <td className="doc-goods-mid">{l.lineNo}</td>
            <td>
              <div className="doc-goods-desc-main doc-mono">{l.mpn}</div>
              <div className="doc-goods-desc-sub">
                {l.description}
                {l.manufacturer ? ` · ${l.manufacturer}` : ''}
              </div>
              <div className="doc-goods-desc-sub">
                Harmonised System of Nomenclature / Service Accounting Code: {l.hsnCode}
              </div>
              {l.extras?.map((e, i) => (
                <div key={i} className="doc-goods-desc-sub">
                  {e}
                </div>
              ))}
            </td>
            <td className="doc-goods-num">
              {l.quantity.toLocaleString('en-IN')} {l.uom}
            </td>
            <td className="doc-goods-num">{l.unitPrice.toLocaleString('en-IN')}</td>
            <td className="doc-goods-mid">{l.uom}</td>
            <td className="doc-goods-num">{bare(l.lineTotal, currency)}</td>
          </tr>
        ))}
        {filler && (
          <tr className="doc-goods-filler" aria-hidden>
            <td colSpan={6} />
          </tr>
        )}
        <tr className="doc-goods-total">
          <td />
          <td style={{ textAlign: 'right' }}>Total</td>
          <td className="doc-goods-num">
            {totalQuantity.toLocaleString('en-IN')} {totalUom}
          </td>
          <td />
          <td />
          <td className="doc-goods-num">
            {currency} {bare(totalValue, currency)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The proforma invoice's goods table: description · quantity · unit price · amount. */
export function ProformaGoodsTable({
  lines,
  currency,
  totalQuantity,
  totalUom,
  totalValue,
}: {
  lines: PrintLine[];
  currency: string;
  totalQuantity: number;
  totalUom: string;
  totalValue: number;
}) {
  return (
    <table className="doc-goods">
      <thead>
        <tr>
          <th>Description of Goods &amp; Service</th>
          <th style={{ width: '16%' }}>Quantity</th>
          <th style={{ width: '19%' }}>Unit Price</th>
          <th style={{ width: '19%' }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.lineNo}>
            <td>
              <div className="doc-goods-desc-main">{l.description}</div>
              <div className="doc-goods-desc-sub">
                Manufacturer Part Number{' '}
                <strong className="doc-mono" style={{ color: '#000' }}>
                  {l.mpn}
                </strong>
              </div>
              <div className="doc-goods-desc-sub">
                With Harmonised System of Nomenclature Code {l.hsnCode}
              </div>
              {l.extras?.map((e, i) => (
                <div key={i} className="doc-goods-desc-sub">
                  {e}
                </div>
              ))}
            </td>
            <td className="doc-goods-num">
              {l.quantity.toLocaleString('en-IN')} {l.uom}
            </td>
            <td className="doc-goods-num">
              {currency}
              {l.unitPrice.toLocaleString('en-IN', { maximumFractionDigits: 4 })}/{l.uom}
            </td>
            <td className="doc-goods-num">
              {currency}
              {bare(l.lineTotal, currency)}
            </td>
          </tr>
        ))}
        <tr className="doc-goods-total">
          <td style={{ textAlign: 'right' }}>Total Quantity</td>
          <td className="doc-goods-num">
            {totalQuantity.toLocaleString('en-IN')} {totalUom}
          </td>
          <td style={{ textAlign: 'right' }}>Total Amount</td>
          <td className="doc-goods-num">
            {currency}
            {bare(totalValue, currency)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Amount in words ────────────────────────────────────────────────────────

export function AmountInWords({
  label,
  words,
  eoe,
}: {
  label: string;
  words: string;
  /** "Errors & Omissions Excepted" — the standard voucher caveat. */
  eoe?: boolean;
}) {
  return (
    <table className="doc-words">
      <tbody>
        <tr>
          <td className="doc-words-label">{label}</td>
          <td className="doc-words-value">{words}</td>
          {eoe && (
            <td className="doc-words-eoe" title="Errors and Omissions Excepted">
              E. &amp; O.E.
            </td>
          )}
        </tr>
      </tbody>
    </table>
  );
}

// ── Notes ──────────────────────────────────────────────────────────────────

export function NumberedNotes({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="doc-notes">
      <div className="doc-notes-label">{label}</div>
      <ol>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
    </section>
  );
}

// ── Bank block ─────────────────────────────────────────────────────────────

export function BankBlock({
  label,
  bank,
}: {
  label: string;
  bank: {
    bankName: string | null;
    bankAddress: string | null;
    beneficiary: string | null;
    beneficiaryAddress: string | null;
    account: string | null;
    swift: string | null;
    feeNote: string | null;
  };
}) {
  const rows: [string, React.ReactNode, boolean?][] = [
    ['Beneficiary bank', bank.bankName, false],
    ['Bank address', bank.bankAddress, false],
    ['Beneficiary', bank.beneficiary, false],
    ['Beneficiary address', bank.beneficiaryAddress, false],
    [
      'Beneficiary Account Number',
      bank.account ? <span className="doc-mono">{bank.account}</span> : null,
      true,
    ],
    [
      'Society for Worldwide Interbank Financial Telecommunication code',
      bank.swift ? <span className="doc-mono">{bank.swift}</span> : null,
      true,
    ],
    ['Bank transfer fee', bank.feeNote, false],
  ];
  const present = rows.filter(([, v]) => v);
  if (present.length === 0) return null;
  return (
    <section className="doc-notes">
      <div className="doc-notes-label">{label}</div>
      <table className="doc-bank">
        <tbody>
          {present.map(([k, v, strong], i) => (
            <tr key={i}>
              <th scope="row">{k}</th>
              <td className={strong ? 'doc-bank-strong' : undefined}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Signatures ─────────────────────────────────────────────────────────────

export function AuthorisedSignatory({ forName }: { forName: string }) {
  return (
    <div className="doc-signoff">
      <div className="doc-signoff-for">for {forName}</div>
      <div className="doc-signoff-rule">Authorised Signatory</div>
    </div>
  );
}

export function StampBlock({ name }: { name: string }) {
  return (
    <div className="doc-sigblock">
      <div className="doc-sigblock-name">{name}</div>
      <div className="doc-sigblock-stamp">(with company stamp)</div>
    </div>
  );
}

export function JurisdictionFooter({ jurisdiction }: { jurisdiction: string | null }) {
  return (
    <div className="doc-jurisdiction">
      {jurisdiction ? `SUBJECT TO ${jurisdiction.toUpperCase()} JURISDICTION  |  ` : ''}
      This is a Computer Generated Document
    </div>
  );
}

export function FootNote({ children }: { children: React.ReactNode }) {
  return <div className="doc-footnote">{children}</div>;
}

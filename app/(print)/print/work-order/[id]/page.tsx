import { notFound } from 'next/navigation';
import { getWorkOrderDocument } from '@/lib/queries/print';
import { formatMoney } from '@/lib/domain/money';
import { PrintToolbar } from '@/components/print/PrintToolbar';
import { escrowFunderMeta } from '@/lib/domain/enums';
import {
  AmountInWords,
  DocSheet,
  DocTitle,
  JurisdictionFooter,
  PartyBlock,
  VoucherField,
  VoucherGoodsTable,
  voucherDate,
} from '@/components/print/DocumentParts';

export const dynamic = 'force-dynamic';

/**
 * The internal work order. Same voucher form as the purchase order so the set
 * reads as one family, but its subject is the job rather than a transaction:
 * which customer order it serves, which supplier order fulfils it, and the four
 * linked documents whose numbers make up its name.
 *
 * It carries two signatures — prepared and approved — because the work order is
 * what authorises money to move, and one person should never do that alone.
 */
export default async function WorkOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ embedded?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Embedded in the in-app viewer, which supplies its own controls.
  const embedded = sp.embedded === '1';
  const doc = await getWorkOrderDocument(id);
  if (!doc) notFound();

  const money = (minor: number, ccy: string) => formatMoney(minor, ccy, { withCode: true });

  return (
    <>
      {!embedded && (
      <PrintToolbar
        title={`Work Order · ${doc.alias}`}
        subtitle={`${doc.customer.name} · ${doc.stageLabel}`}
        backHref={`/orders/${doc.id}`}
      />
      )}

      <DocSheet>
        <DocTitle>Work Order</DocTitle>

        <table className="doc-voucher">
          <tbody>
            <tr>
              <td style={{ width: '56%' }}>
                <PartyBlock label="Raised by (Merchant of Record)" party={doc.oneBuy} />
              </td>
              <td style={{ width: '22%' }}>
                <VoucherField label="Work Order No.">{doc.alias}</VoucherField>
              </td>
              <td style={{ width: '22%' }}>
                <VoucherField label="Dated">{voucherDate(doc.createdAt)}</VoucherField>
              </td>
            </tr>
            <tr>
              <td>
                <PartyBlock label="Customer (sold to)" party={doc.customer} />
              </td>
              <td colSpan={2}>
                <VoucherField label="Work Order Name">
                  <span className="doc-mono" style={{ fontSize: '8.5pt' }}>
                    {doc.canonicalName}
                  </span>
                </VoucherField>
              </td>
            </tr>
            <tr>
              <td rowSpan={4}>
                <PartyBlock label="Supplier (bought from)" party={doc.supplier} />
              </td>
              <td>
                <VoucherField label="Current Stage">{doc.stageLabel}</VoucherField>
              </td>
              <td>
                <VoucherField label="Status">{doc.status}</VoucherField>
              </td>
            </tr>
            <tr>
              <td>
                <VoucherField label="Mode/Terms of Payment">{doc.paymentMethod}</VoucherField>
              </td>
              <td>
                <VoucherField label="Terms of Delivery">{doc.incoterms}</VoucherField>
              </td>
            </tr>
            <tr>
              <td>
                <VoucherField label="Testing Required">
                  {doc.testingRequired
                    ? `Yes${doc.testScope ? ` — ${doc.testScope.replace(/_/g, ' ').toLowerCase()}` : ''}`
                    : 'No'}
                </VoucherField>
              </td>
              <td>
                <VoucherField label="Rate of Exchange">
                  {doc.buyCurrency === doc.sellCurrency
                    ? 'Not applicable'
                    : `1 ${doc.buyCurrency} = ${doc.fxRate} ${doc.sellCurrency}`}
                </VoucherField>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                <VoucherField label="Escrow Arrangement">
                  {doc.escrowFundedBy
                    ? `Funded by ${escrowFunderMeta(doc.escrowFundedBy).partyLabel}${
                        doc.escrowBasis
                          ? ` on a ${doc.escrowBasis.replace(/_/g, ' ').toLowerCase()} basis`
                          : ''
                      }, per the agreed terms`
                    : 'Not applicable'}
                </VoucherField>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── The four linked documents ───────────────────────────────────── */}
        <table className="doc-voucher" style={{ marginTop: '-0.9px' }}>
          <tbody>
            <tr>
              <td>
                <VoucherField label="Customer Purchase Order">
                  {doc.customerPoNumber}
                  <span style={{ fontWeight: 400, fontSize: '8.5pt' }}>
                    {' '}
                    dt. {voucherDate(doc.customerPoDate)}
                  </span>
                </VoucherField>
              </td>
              <td>
                <VoucherField label="Our Proforma Invoice">
                  {doc.customerPiNumber ?? 'Not yet issued'}
                </VoucherField>
              </td>
              <td>
                <VoucherField label="Our Purchase Order">
                  {doc.supplierPoNumber}
                  <span style={{ fontWeight: 400, fontSize: '8.5pt' }}>
                    {' '}
                    dt. {voucherDate(doc.supplierPoDate)}
                  </span>
                </VoucherField>
              </td>
              <td>
                <VoucherField label="Supplier Proforma Invoice">
                  {doc.supplierPiNumber ?? 'Awaited'}
                </VoucherField>
              </td>
            </tr>
          </tbody>
        </table>

        <VoucherGoodsTable
          lines={doc.lines}
          currency={doc.sellCurrency}
          totalQuantity={doc.totalQuantity}
          totalUom={doc.totalUom}
          totalValue={doc.sellValue}
          filler={false}
        />

        <AmountInWords label="Sale Value (in words)" words={doc.sellValueInWords} eoe />

        {/* ── Commercial summary ──────────────────────────────────────────── */}
        <table className="doc-voucher" style={{ marginTop: '10px' }}>
          <tbody>
            <tr>
              <td>
                <VoucherField label="Sale Value to Customer">
                  {money(doc.sellValue, doc.sellCurrency)}
                </VoucherField>
              </td>
              <td>
                {/* Both figures: the supplier's own, and ours after conversion.
                    Printing only the converted number asks the reader to trust a
                    rate they cannot see on the page. */}
                <VoucherField label="Purchase Value from Supplier">
                  {money(doc.buyValueNative, doc.buyNativeCurrency)}
                  {doc.buyNativeCurrency !== doc.reportingCurrency && (
                    <span style={{ fontWeight: 400, fontSize: '8.5pt' }}>
                      {' '}
                      ({money(doc.buyValue, doc.reportingCurrency)})
                    </span>
                  )}
                </VoucherField>
              </td>
              <td>
                <VoucherField label="Phase">
                  {doc.phase} — {doc.stageLabel}
                </VoucherField>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Two signatures: preparing and approving are separate acts. */}
        <table className="doc-voucher" style={{ marginTop: '-0.9px' }}>
          <tbody>
            <tr>
              <td style={{ height: '74px', verticalAlign: 'top' }}>
                <div className="doc-field-label">Prepared by</div>
                <div className="doc-field-value" style={{ marginTop: '34px' }}>
                  {doc.preparedBy}
                </div>
              </td>
              <td style={{ height: '74px', verticalAlign: 'top' }}>
                <div className="doc-field-label">Approved by</div>
                <div className="doc-field-value" style={{ marginTop: '34px' }}>
                  {doc.approvedBy}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <JurisdictionFooter jurisdiction={doc.jurisdiction} />
      </DocSheet>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getWorkOrderDocument(id);
  return { title: doc ? `Work Order ${doc.alias}` : 'Work Order' };
}

import { notFound } from 'next/navigation';
import { getPurchaseOrderDocument } from '@/lib/queries/print';
import { PrintToolbar } from '@/components/print/PrintToolbar';
import {
  AmountInWords,
  AuthorisedSignatory,
  DocSheet,
  DocTitle,
  JurisdictionFooter,
  NumberedNotes,
  PartyBlock,
  VoucherField,
  VoucherGoodsTable,
  voucherDate,
} from '@/components/print/DocumentParts';

export const dynamic = 'force-dynamic';

/**
 * The supplier purchase order, in the Tally voucher form Indian suppliers and
 * accountants already recognise: three party boxes down the left, the voucher's
 * commercial terms down the right, then goods, total, amount in words,
 * conditions and the signatory.
 */
export default async function PurchaseOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ embedded?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Embedded in the in-app viewer, which supplies its own controls.
  const embedded = sp.embedded === '1';
  const doc = await getPurchaseOrderDocument(id);
  if (!doc) notFound();

  return (
    <>
      {!embedded && (
      <PrintToolbar
        title={`Purchase Order · ${doc.voucherNo}`}
        subtitle={`${doc.supplier.name} · ${voucherDate(doc.poDate)}`}
        backHref={doc.workOrderId ? `/orders/${doc.workOrderId}` : '/orders'}
      />
      )}

      <DocSheet>
        <DocTitle>Purchase Order</DocTitle>

        {/* Two independent columns, each with its own stack of rows — the parties
            on the left and the voucher's commercial terms on the right have no
            reason to share horizontal rules, and forcing them to (with rowspans)
            leaves dead space wherever the two stacks differ in height. */}
        <table className="doc-voucher">
          <tbody>
            <tr>
              <td className="doc-nested" style={{ width: '56%' }}>
                <table className="doc-substack">
                  <tbody>
                    <tr>
                      <td>
                        <PartyBlock label="Invoice To" party={doc.invoiceTo} />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <PartyBlock label="Consignee (Ship to)" party={doc.consignee} />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <PartyBlock label="Supplier (Bill from)" party={doc.supplier} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td className="doc-nested" style={{ width: '44%' }}>
                <table className="doc-substack">
                  <tbody>
                    <tr>
                      <td style={{ width: '50%' }}>
                        <VoucherField label="Voucher No.">{doc.voucherNo}</VoucherField>
                      </td>
                      <td style={{ width: '50%' }}>
                        <VoucherField label="Dated">{voucherDate(doc.poDate)}</VoucherField>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={2}>
                        <VoucherField label="Reference No. &amp; Date.">
                          {doc.referenceNo ?? '—'}
                          {doc.referenceDate ? ` dt. ${voucherDate(doc.referenceDate)}` : ''}
                        </VoucherField>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={2}>
                        <VoucherField label="Mode/Terms of Payment">
                          {doc.paymentTerms}
                        </VoucherField>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <VoucherField label="Dispatched through">
                          {doc.dispatchedThrough}
                        </VoucherField>
                      </td>
                      <td>
                        <VoucherField label="Destination">{doc.destination}</VoucherField>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={2}>
                        <VoucherField label="Terms of Delivery">
                          {doc.termsOfDelivery}
                        </VoucherField>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <VoucherGoodsTable
          lines={doc.lines}
          currency={doc.currency}
          totalQuantity={doc.totalQuantity}
          totalUom={doc.totalUom}
          totalValue={doc.totalValue}
        />

        <AmountInWords label="Amount Chargeable (in words)" words={doc.amountInWords} eoe />

        <NumberedNotes label="Terms and Conditions" items={doc.terms} />

        <AuthorisedSignatory forName={doc.signatoryFor} />

        <JurisdictionFooter jurisdiction={doc.jurisdiction} />
      </DocSheet>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getPurchaseOrderDocument(id);
  return { title: doc ? `Purchase Order ${doc.voucherNo}` : 'Purchase Order' };
}

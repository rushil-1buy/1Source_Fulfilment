import { notFound } from 'next/navigation';
import { getProformaInvoiceDocument } from '@/lib/queries/print';
import { PrintToolbar } from '@/components/print/PrintToolbar';
import {
  AmountInWords,
  BankBlock,
  DocSheet,
  DocTitle,
  FootNote,
  Ladder,
  LadderParty,
  Letterhead,
  NumberedNotes,
  ProformaGoodsTable,
  StampBlock,
  longDate,
} from '@/components/print/DocumentParts';

export const dynamic = 'force-dynamic';

/**
 * The proforma invoice, in the seller's own letterhead form: who is selling at
 * the top, then the commercial terms as a label/value ladder, the goods, the
 * amount in words, remarks, and the telegraphic-transfer bank details.
 *
 * Both parties sign, on their own sheet — a proforma is an offer, and the
 * countersignature is what turns it into agreed terms (which is the same moment
 * the flow locks them).
 */
export default async function ProformaInvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ embedded?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Embedded in the in-app viewer, which supplies its own controls.
  const embedded = sp.embedded === '1';
  const doc = await getProformaInvoiceDocument(id);
  if (!doc) notFound();

  const shownNumber = doc.externalRef ?? doc.piNumber;

  return (
    <>
      {!embedded && (
      <PrintToolbar
        title={`Proforma Invoice · ${shownNumber}`}
        subtitle={`${doc.seller.name} → ${doc.buyer.name}`}
        backHref={doc.workOrderId ? `/orders/${doc.workOrderId}` : '/orders'}
      />
      )}

      <DocSheet>
        <Letterhead party={doc.seller} />

        <DocTitle>Proforma Invoice</DocTitle>

        <Ladder
          items={[
            ...(doc.attention ? [{ label: 'Attn', block: doc.attention }] : []),
            { label: 'The Buyer', block: <LadderParty party={doc.buyer} /> },
            { label: 'Invoice No.', value: shownNumber },
            ...(doc.sourcingRef
              ? [{ label: 'Enquiry reference', value: doc.sourcingRef }]
              : []),
            { label: 'Date', value: longDate(doc.piDate) },
            ...(doc.validUntil
              ? [{ label: 'Offer valid until', value: longDate(doc.validUntil) }]
              : []),
            { label: 'Shipment method', value: doc.shipmentMethod },
            { label: 'From', value: doc.originLocation },
            { label: 'Destination', value: doc.destination },
            { label: 'Delivery time', value: doc.deliveryTime },
            { label: 'Payment term', value: doc.paymentTerm },
          ]}
        />

        <ProformaGoodsTable
          lines={doc.lines}
          currency={doc.currency}
          totalQuantity={doc.totalQuantity}
          totalUom={doc.totalUom}
          totalValue={doc.totalValue}
        />

        <AmountInWords label="Amount (in words)" words={doc.amountInWords} />

        <NumberedNotes label="Remark" items={doc.remarks} />

        {doc.bank && (
          <BankBlock
            label={`Bank Account (for telegraphic transfer in ${doc.currency})`}
            bank={doc.bank}
          />
        )}
      </DocSheet>

      {/* Signatures take their own sheet, as on the reference document. */}
      <DocSheet>
        <div className="doc-pagebreak">
          <StampBlock name={doc.buyer.name} />
          <StampBlock name={doc.seller.name} />
          <FootNote>
            Proforma invoice — not a tax invoice. Terms lock on the buyer’s acceptance, which is the
            official freeze in the flow.
          </FootNote>
        </div>
      </DocSheet>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getProformaInvoiceDocument(id);
  return {
    title: doc ? `Proforma Invoice ${doc.externalRef ?? doc.piNumber}` : 'Proforma Invoice',
  };
}

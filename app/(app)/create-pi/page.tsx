import { Suspense } from 'react';
import { getCustomerPosForPi, getSupplierPosForPi } from '@/lib/queries/pi';
import { getOrgSetting } from '@/lib/queries/masters';
import { SkeletonRows } from '@/components/ui/Layout';
import { CreatePiForm } from './CreatePiForm';

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


export const metadata = { title: 'Create PI' };

export default async function CreatePiPage() {
  const [customerPos, supplierPos, org] = await Promise.all([
    getCustomerPosForPi(),
    getSupplierPosForPi(),
    getOrgSetting(),
  ]);

  return (
    <Suspense fallback={<div className="p-6"><SkeletonRows rows={8} cols={5} /></div>}>
      <CreatePiForm
        customerPos={customerPos}
        supplierPos={supplierPos}
        org={
          org
            ? {
                legalName: org.legalName,
                brandName: org.brandName,
                gstin: org.gstin,
                stateName: org.stateName,
              }
            : null
        }
      />
    </Suspense>
  );
}

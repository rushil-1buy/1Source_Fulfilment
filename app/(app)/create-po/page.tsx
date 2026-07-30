import { Suspense } from 'react';
import {
  getCustomerOptions,
  getLinkableCustomerPos,
  getMpnOptions,
  getOrgSetting,
  getSupplierOptions,
} from '@/lib/queries/masters';
import { SkeletonRows } from '@/components/ui/Layout';
import { CreatePoForm } from './CreatePoForm';

export const metadata = { title: 'Create PO' };

export default async function CreatePoPage() {
  const [customers, suppliers, mpns, linkablePos, org] = await Promise.all([
    getCustomerOptions(),
    getSupplierOptions(),
    getMpnOptions(),
    getLinkableCustomerPos(),
    getOrgSetting(),
  ]);

  return (
    // useSearchParams inside the form needs a Suspense boundary.
    <Suspense fallback={<div className="p-6"><SkeletonRows rows={8} cols={5} /></div>}>
      <CreatePoForm
        customers={customers}
        suppliers={suppliers}
        mpns={mpns}
        linkablePos={linkablePos}
        marginFloorPct={org?.marginFloorPct ?? 8}
      />
    </Suspense>
  );
}

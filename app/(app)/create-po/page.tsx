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

/**
 * Never prerendered.
 *
 * Every screen here reads live operational data. Without this, Next prerenders
 * at build time and serves a snapshot of the database taken during CI — an
 * orders list frozen at deploy, and on a serverless host with no build-time
 * database, a build that fails outright.
 */
export const dynamic = 'force-dynamic';


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

/**
 * Left sidebar navigation — master prompt §6, in the exact order specified.
 * `plainLabel` feeds Plain English mode (§8.2).
 */

export interface NavItem {
  href: string;
  label: string;
  plainLabel: string;
  icon: string; // lucide icon name
  /** One-line "what is this screen for", shown in the collapsed-rail tooltip. */
  hint: string;
  children?: { href: string; label: string; plainLabel: string }[];
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'work',
    label: null,
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        plainLabel: 'Overview',
        icon: 'LayoutDashboard',
        hint: 'Control tower — where every order stands right now.',
      },
    ],
  },
  {
    /**
     * The five internal teams, each a filtered view of the same orders.
     *
     * Placed directly under the Dashboard because that is the relationship: the
     * Control Tower is every order, and these are the same orders narrowed to
     * one desk. Anywhere further down and they read as separate modules with
     * their own data, which is exactly what they are not.
     */
    id: 'teams',
    label: 'My team',
    items: [
      {
        href: '/teams/sourcing',
        label: '1BUY Sourcing',
        plainLabel: 'Sourcing desk',
        icon: 'ShoppingCart',
        hint: 'The order, the quote, the supplier and the terms.',
      },
      {
        href: '/teams/finance',
        label: '1BUY Finance',
        plainLabel: 'Finance desk',
        icon: 'Banknote',
        hint: 'Escrow, duty, the tax invoice and getting paid.',
      },
      {
        href: '/teams/inbound',
        label: '1BUY Logistics — inbound',
        plainLabel: 'Inbound desk',
        icon: 'PackageOpen',
        hint: 'Export clearance, customs release and goods arriving with us.',
      },
      {
        href: '/teams/inspection',
        label: '1BUY Inspection',
        plainLabel: 'Inspection desk',
        icon: 'ClipboardCheck',
        hint: 'Test scope, inbound inspection and signing the repack off.',
      },
      {
        href: '/teams/outbound',
        label: '1BUY Logistics — outbound',
        plainLabel: 'Outbound desk',
        icon: 'Truck',
        hint: 'Repack, despatch, delivery and proof of delivery.',
      },
    ],
  },
  {
    id: 'agentic',
    label: null,
    items: [
      {
        href: '/agentic',
        label: 'Autonomous flow',
        plainLabel: 'How the agent would run it',
        icon: 'Bot',
        hint: 'Walkthrough of the agentic flow — and where it hands back to a person.',
      },
    ],
  },
  {
    id: 'create',
    label: 'Create',
    items: [
      {
        href: '/create-po',
        label: 'Create Purchase Order',
        plainLabel: 'Create purchase order',
        icon: 'FilePlus2',
        hint: "Enter a customer's order, or raise our order to a supplier.",
        children: [
          { href: '/create-po?mode=customer', label: 'Customer Purchase Order', plainLabel: "Customer's order" },
          { href: '/create-po?mode=supplier', label: 'Our Purchase Order to supplier', plainLabel: 'Our order to supplier' },
        ],
      },
      {
        href: '/create-pi',
        label: 'Create Proforma Invoice',
        plainLabel: 'Create price quote',
        icon: 'ReceiptText',
        hint: 'Issue a Proforma Invoice to a customer, or record a supplier one.',
        children: [
          { href: '/create-pi?mode=customer', label: 'Customer Proforma Invoice', plainLabel: 'Quote to customer' },
          { href: '/create-pi?mode=supplier', label: 'Supplier Proforma Invoice capture', plainLabel: "Supplier's quote" },
        ],
      },
      {
        href: '/purchase-orders',
        label: 'Created Purchase Orders',
        plainLabel: 'Purchase orders',
        icon: 'ClipboardCheck',
        hint: 'Every purchase order raised — from customers, and to suppliers.',
        children: [
          { href: '/purchase-orders?tab=customer', label: 'From customers', plainLabel: 'Customer orders' },
          { href: '/purchase-orders?tab=supplier', label: 'To suppliers', plainLabel: 'Our orders out' },
        ],
      },
    ],
  },
  {
    id: 'operate',
    label: 'Operate',
    items: [
      {
        href: '/orders',
        label: 'Orders',
        plainLabel: 'Jobs',
        icon: 'ClipboardList',
        hint: 'Internal work orders — the operational heart of the platform.',
      },
      {
        href: '/escrow',
        label: 'Escrow',
        plainLabel: 'Held money',
        icon: 'Landmark',
        hint: 'Money held by a neutral third party, and its releases.',
      },
      {
        href: '/testing',
        label: 'Testing Laboratory',
        plainLabel: 'Lab testing',
        icon: 'FlaskConical',
        hint: 'Independent laboratory checks before the full shipment moves.',
      },
      {
        href: '/logistics',
        label: 'Logistics',
        plainLabel: 'Shipping',
        icon: 'Truck',
        hint: 'All four shipping legs, with tracking.',
      },
      {
        href: '/customs',
        label: 'Customs & Compliance',
        plainLabel: 'Customs',
        icon: 'ShieldCheck',
        hint: 'Bills of Entry, duty and clearance via the customs agent.',
      },
      {
        href: '/warehouse',
        label: 'Warehouse',
        plainLabel: 'Warehouse',
        icon: 'Warehouse',
        hint: 'Receiving, inspection, rebranding and repacking, and outbound delivery.',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance & Tax',
    items: [
      {
        href: '/tax',
        label: 'Tax & Goods and Services Tax',
        plainLabel: 'Tax',
        icon: 'Calculator',
        hint: 'Output tax, input credits, registers and return working sheets.',
      },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    items: [
      {
        href: '/avl',
        label: 'Approved Vendor List',
        plainLabel: 'Approved suppliers',
        icon: 'BadgeCheck',
        hint: 'The only suppliers we are allowed to buy from.',
      },
      {
        href: '/masters',
        label: 'Masters',
        plainLabel: 'Reference data',
        icon: 'Database',
        hint: 'Customers, suppliers, parts, carriers, laboratories and tax rates.',
      },
      {
        href: '/documents',
        label: 'Documents',
        plainLabel: 'Files',
        icon: 'FolderOpen',
        hint: 'Every document, filed against its order.',
      },
      {
        href: '/reports',
        label: 'Reports & Analytics',
        plainLabel: 'Reports',
        icon: 'ChartNoAxesCombined',
        hint: 'Cycle times, margins, exceptions and trends.',
      },
      {
        href: '/settings',
        label: 'Settings',
        plainLabel: 'Settings',
        icon: 'Settings',
        hint: 'Users, numbering, glossary, connected systems and tax configuration.',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Breadcrumb trail for a pathname. */
export function breadcrumbFor(pathname: string): { label: string; href: string }[] {
  const match = ALL_NAV_ITEMS.filter((i) => pathname.startsWith(i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  if (!match) return [];
  const trail = [{ label: match.label, href: match.href }];
  const rest = pathname.slice(match.href.length).split('/').filter(Boolean);
  let acc = match.href;
  for (const seg of rest) {
    acc += `/${seg}`;
    trail.push({ label: decodeURIComponent(seg), href: acc });
  }
  return trail;
}

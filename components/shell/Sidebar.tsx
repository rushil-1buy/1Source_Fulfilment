'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  BadgeCheck,
  Banknote,
  Calculator,
  ChartNoAxesCombined,
  ChevronRight,
  ChevronsLeft,
  ClipboardCheck,
  ClipboardList,
  Bot,
  Database,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  Landmark,
  Layers,
  LayoutDashboard,
  PackageOpen,
  PanelLeftOpen,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { NAV_GROUPS, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/components/providers/Preferences';

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bot,
  ShoppingCart,
  Banknote,
  PackageOpen,
  Layers,
  FilePlus2,
  ReceiptText,
  ClipboardCheck,
  ClipboardList,
  BadgeCheck,
  Landmark,
  FlaskConical,
  Truck,
  ShieldCheck,
  Warehouse,
  Calculator,
  Database,
  FolderOpen,
  ChartNoAxesCombined,
  Settings,
};

export function Sidebar({
  onNavigate,
  forceExpanded,
}: {
  /** Called after a nav link is clicked — closes the mobile drawer. */
  onNavigate?: () => void;
  /** Drawer mode: always expanded, no collapse control. */
  forceExpanded?: boolean;
} = {}) {
  const pathname = usePathname();
  const [collapsedState, setCollapsed] = useState(false);
  /** Collapsible groups the user has opened this session. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const collapsed = forceExpanded ? false : collapsedState;
  const { label } = usePreferences();

  const isActive = (item: NavItem) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Tooltip.Provider delayDuration={200}>
      <aside
        className={cn(
          'sidebar-inner flex h-dvh shrink-0 flex-col transition-[width] duration-200',
          forceExpanded ? 'w-[268px] max-w-[85vw]' : 'sticky top-0',
          collapsed ? 'w-[64px]' : !forceExpanded && 'w-[248px]',
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div
          className={cn(
            'sidebar-divider-b flex h-14 items-center',
            collapsed ? 'justify-center px-2' : 'gap-2.5 px-4',
          )}
        >
          {/* Brand mark. A single numeral rather than an abbreviation — it reads
              as the start of the "1BUY Fulfilment" wordmark beside it. */}
          <div
            className="text-accent grid size-8 shrink-0 place-items-center rounded-[8px] bg-white text-[15px] font-bold tracking-tight"
            aria-hidden
          >
            1
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13px] leading-tight font-semibold">1BUY Fulfilment</div>
              <div className="text-fg-tertiary truncate text-[11px] leading-tight">
                Merchant of Record
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
          {NAV_GROUPS.map((group, gi) => {
            /*
             * A collapsible group folds unless you are inside it.
             *
             * The auto-open matters more than the fold: hiding the page
             * somebody is currently on would leave the pane with no highlighted
             * row at all, which reads as broken rather than as tidy. When the
             * rail itself is collapsed to icons there is no heading to click,
             * so the fold is ignored and everything shows.
             */
            const hasActive = group.items.some((i) => isActive(i));
            const folded =
              group.collapsible && !collapsed && !hasActive && !openGroups.has(group.id);

            return (
            <div key={group.id} className={cn(gi > 0 && 'mt-4')}>
              {group.label && !collapsed && group.collapsible && (
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  aria-expanded={!folded}
                  className="sidebar-row sidebar-label flex w-full items-center gap-1 rounded-[6px] px-2.5 py-1 pb-1.5 text-[11px] font-semibold uppercase transition-colors"
                >
                  <ChevronRight
                    className={cn('size-3 shrink-0 transition-transform', !folded && 'rotate-90')}
                    strokeWidth={2.4}
                    aria-hidden
                  />
                  <span className="truncate">{group.label}</span>
                </button>
              )}
              {group.label && !collapsed && !group.collapsible && (
                <div className="sidebar-label px-2.5 pb-1.5 text-[11px] font-semibold uppercase">
                  {group.label}
                </div>
              )}
              {group.label && collapsed && gi > 0 && (
                <div className="sidebar-divider mx-2 mb-2 h-px" aria-hidden />
              )}
              <ul className={cn('space-y-0.5', folded && 'hidden')}>
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? ClipboardList;
                  const active = isActive(item);
                  const link = (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-[13px] transition-colors',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'sidebar-row-active'
                          : 'sidebar-row text-fg-secondary hover:text-fg',
                      )}
                    >
                      <Icon className="size-[17px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                      {!collapsed && (
                        <span className="truncate">{label(item.label, item.plainLabel)}</span>
                      )}
                    </Link>
                  );

                  return (
                    <li key={item.href}>
                      {collapsed ? (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content
                              side="right"
                              sideOffset={8}
                              className="bg-surface-2 border-line text-fg shadow-e3 z-50 max-w-[240px] rounded-[8px] border px-2.5 py-1.5 text-xs"
                            >
                              <div className="font-medium">{label(item.label, item.plainLabel)}</div>
                              <div className="text-fg-tertiary mt-0.5">{item.hint}</div>
                              <Tooltip.Arrow className="fill-[var(--surface-2)]" />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            );
          })}
        </nav>

        <div className={cn('border-line-subtle border-t p-2', forceExpanded && 'hidden')}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="sidebar-row text-fg-tertiary hover:text-fg flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-[13px] transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[17px] shrink-0" strokeWidth={1.8} />
            ) : (
              <>
                <ChevronsLeft className="size-[17px] shrink-0" strokeWidth={1.8} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </Tooltip.Provider>
  );
}

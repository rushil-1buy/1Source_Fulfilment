'use server';

/**
 * Read-only endpoints for the top bar.
 *
 * The palette and the bell need live data from the client, and neither is tied to
 * a page render — the palette opens over whatever screen you are on, and the bell
 * has to be able to refresh without a navigation. Server actions are the smallest
 * way to give them that without inventing a route handler for each.
 */

import { globalSearch, type SearchOutcome } from '@/lib/queries/search';
import { getNotifications, type NotificationFeed } from '@/lib/queries/notifications';

export async function searchEverything(query: string): Promise<SearchOutcome> {
  return globalSearch(query);
}

export async function fetchNotifications(): Promise<NotificationFeed> {
  return getNotifications();
}

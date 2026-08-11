/**
 * Shared contract for the earned share-card templates.
 *
 * Every template is a pure renderer of the SAME walk content the Fieldbook
 * card (MomentCard) shows — route, headline, stats, place, date, wordmark.
 * The unlock gate lives in lib/momentTemplates.ts and the picker; a template
 * component itself never knows about walk counts, and must never render one.
 */

import type { MomentRoutePoint, MomentStats, SniffStop } from '../../lib/momentCard';
import type { WalkLabels } from '../../lib/walk/geoLabels';
import type { MomentColorwayId } from '../../lib/momentTemplates';

export interface TemplateCardProps {
  petName: string;
  petGender?: string | null;
  /** Walk start, ms since epoch. */
  startedAt: number;
  route: MomentRoutePoint[];
  /** Sniff stops with dwell — resolve rows via resolveSniffStops. */
  sniffStops: SniffStop[];
  labels: WalkLabels;
  stats: MomentStats;
  /** Seeds the companion weave — the walk session id. */
  sessionId: string;
  /** Card width in dp; height follows the template's aspect. */
  width?: number;
  /** Premium palette swap; every template renders 'classic' by default. */
  colorway?: MomentColorwayId;
}

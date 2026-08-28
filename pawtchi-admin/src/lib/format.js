/** Shared display helpers. Kept out of components so both pages read the same. */

/** "4h" / "3d" — how long someone has been waiting, which is the number that matters. */
export function age(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function fullDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The same short reference the owner sees on their confirmation screen. */
export function reference(id) {
  const head = (id || '').replace(/-/g, '').slice(0, 4).toUpperCase();
  return head ? `PAW-${head}` : 'PAW';
}

export const AREA_LABEL = {
  meals: 'Meals & scanning',
  walks: 'Walks',
  health: 'Health & weight',
  notifications: 'Notifications',
  subscription: 'Subscription',
  other: 'Something else',
};

/** Human labels for the diagnostics keys worth showing. Order is the display order. */
export const DIAG_FIELDS = [
  ['error_kind', 'Failure seen'],
  ['error_context', 'Where it failed'],
  ['screen', 'Screen'],
  ['app_version', 'App version'],
  ['build', 'Build'],
  ['device_model', 'Device'],
  ['os', 'OS'],
  ['os_version', 'OS version'],
  ['is_device', 'Real device'],
  ['locale', 'Locale'],
  ['timezone', 'Timezone'],
  ['subscription_status', 'Subscription'],
  ['is_pro', 'Pro'],
  ['species', 'Species'],
  ['pet_id', 'Pet id'],
  ['walk_id', 'Walk id'],
  ['scan_id', 'Scan id'],
  ['entry_source', 'Came from'],
  ['submitted_at', 'Submitted'],
];

export function diagValue(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

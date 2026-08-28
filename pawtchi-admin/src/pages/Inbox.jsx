import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchQueue } from '../lib/api';
import { AREA_LABEL, age } from '../lib/format';

/**
 * One queue, two channels, kept visually distinct.
 *
 * Merging support tickets and founder letters into an undifferentiated list
 * would undo the thing the whole design rests on: they carry different promises
 * and want different replies. A letter answered in a support voice is worse
 * than no reply. So they share a queue for ordering, and nothing else.
 *
 * Default filter is "waiting", oldest first. That is the queue discipline, not
 * a default: newest-first means the request that has waited longest is the one
 * you scroll past, which is exactly how a two-business-day promise quietly
 * stops being true.
 */
export default function Inbox() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('waiting');

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await fetchQueue());
    } catch {
      setError('Could not load the queue. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // The tab is likely to sit open all day, and a queue that silently goes
    // stale is how something waits an extra afternoon.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const counts = useMemo(
    () => ({
      waiting: items.filter((i) => i.status === 'open').length,
      tickets: items.filter((i) => i.kind === 'ticket' && i.status === 'open').length,
      letters: items.filter((i) => i.kind === 'letter' && i.status === 'open').length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    switch (filter) {
      case 'waiting': return items.filter((i) => i.status === 'open');
      case 'tickets': return items.filter((i) => i.kind === 'ticket');
      case 'letters': return items.filter((i) => i.kind === 'letter');
      default: return items;
    }
  }, [items, filter]);

  const subtitle = () => {
    if (counts.waiting === 0) return 'Nothing is waiting on a reply.';
    const t = `${counts.tickets} support ${counts.tickets === 1 ? 'request' : 'requests'}`;
    const l = `${counts.letters} ${counts.letters === 1 ? 'letter' : 'letters'}`;
    if (counts.tickets === 0) return l;
    if (counts.letters === 0) return t;
    return `${t} · ${l}`;
  };

  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Inbox</p>
        <h1 className="display">{counts.waiting === 0 ? 'ALL CLEAR' : `${counts.waiting} WAITING`}</h1>
        <p className="sub">{subtitle()}</p>
      </header>

      <div className="filters">
        {[
          ['waiting', 'Waiting'],
          ['tickets', 'Support'],
          ['letters', 'Letters'],
          ['all', 'Everything'],
        ].map(([id, label]) => (
          <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="chip" onClick={load}>Refresh</button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {loading ? (
        <div className="spinner" aria-label="Loading" />
      ) : visible.length === 0 ? (
        <div className="card empty">
          {filter === 'waiting'
            ? 'Nothing is waiting. Everything that has come in has been answered.'
            : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="rows">
          {visible.map((item) => (
            <Row
              key={`${item.kind}:${item.id}`}
              item={item}
              onOpen={() => navigate(`/${item.kind}/${item.id}`)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

/**
 * Three tiers: what kind of thing it is, what they actually said, and who they
 * are. The sentence someone wrote is the headline — everything else is
 * supporting detail and is sized accordingly.
 *
 * All three are block-level `div`s. They were `span`s, which are inline, so
 * they never stacked: the email ran on directly after the body text and long
 * bodies pushed a horizontal scrollbar onto the whole page.
 */
function Row({ item, onOpen }) {
  const answered = item.status !== 'open';
  const isLetter = item.kind === 'letter';
  const churn = isLetter && item.entrySource === 'cancel_intent';

  const meta = [
    item.email ?? 'no email on file',
    item.diagnostics?.error_kind
      ? `saw “${String(item.diagnostics.error_kind).replace(/_/g, ' ')}”`
      : null,
    item.attachmentPath ? 'screenshot attached' : null,
    answered ? 'answered' : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <button className="row" onClick={onOpen}>
      <span
        className={`status${answered ? ' status-answered' : ''}`}
        aria-label={answered ? 'Answered' : 'Waiting'}
      />

      <div className="row-body">
        <div className="row-top">
          <span className={`badge badge-${isLetter ? 'letter' : item.topic}`}>
            {isLetter ? 'Letter' : item.topic}
          </span>

          {/* Churn letters are the highest-signal thing in this list: someone on
              their way out explaining why. Flagged so they are never skimmed past. */}
          {churn && <span className="badge badge-churn">Leaving</span>}

          {!isLetter && (
            <span className="badge badge-quiet">{AREA_LABEL[item.area] ?? item.area}</span>
          )}

          <span className="row-age">{age(item.createdAt)}</span>
        </div>

        <p className="row-text">{item.body}</p>
        <span className="row-meta">{meta}</span>
      </div>
    </button>
  );
}

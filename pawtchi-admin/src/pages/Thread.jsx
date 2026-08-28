import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { fetchItem, sendReply, signedAttachmentUrl } from '../lib/api';
import { AREA_LABEL, DIAG_FIELDS, diagValue, fullDate, reference } from '../lib/format';

/**
 * One request and its reply.
 *
 * The two channels diverge here more than anywhere else, deliberately:
 *
 *  • A support ticket shows everything the client knew — device, screen, the
 *    failure, and the breadcrumb trail. That is the whole point of collecting
 *    it: the owner wrote one sentence, and this turns it into a reproduction.
 *
 *  • A letter shows the letter. No diagnostics panel, because none is attached
 *    and none should be — the app promises "nothing about your animal is
 *    attached", and a panel implying otherwise would make that a lie.
 */
export default function Thread() {
  const { kind, id } = useParams();
  const navigate = useNavigate();

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shotUrl, setShotUrl] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const found = await fetchItem(kind, id);
      setItem(found);
      if (found?.attachmentPath) setShotUrl(await signedAttachmentUrl(found.attachmentPath));
    } catch {
      setError('Could not load this one. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendReply(kind, id, body);
      setDraft('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="spinner" aria-label="Loading" />;

  if (!item) {
    return (
      <main className="page">
        <button className="link-back" onClick={() => navigate('/')}>← Inbox</button>
        <div className="card empty" style={{ marginTop: 24 }}>That one is no longer here.</div>
      </main>
    );
  }

  const isLetter = item.kind === 'letter';
  const alreadyReplied = item.replies.length > 0;
  // Letters are capped at one reply by a unique index — the exchange is meant
  // to be a letter and an answer, not a thread. Support has no such cap.
  const canReply = !isLetter || !alreadyReplied;

  const heading = isLetter
    ? 'A LETTER'
    : item.topic === 'bug'
      ? 'A PROBLEM'
      : 'A QUESTION';

  return (
    <main className="page">
      <button className="link-back" onClick={() => navigate('/')}>← Inbox</button>

      <header className="thread-head">
        <p className="eyebrow">{isLetter ? 'Letter to the founders' : 'Support request'}</p>
        <h1 className="display">{heading}</h1>
        <div className="sub">
          <span>{item.email ?? 'no email on file'}</span>
          <span className="faint">·</span>
          <span>{fullDate(item.createdAt)}</span>
          {!isLetter && (
            <>
              <span className="badge badge-quiet">{AREA_LABEL[item.area] ?? item.area}</span>
              <span className="mono faint">{reference(item.id)}</span>
            </>
          )}
          {isLetter && item.entrySource === 'cancel_intent' && (
            <span className="badge badge-churn">Written while leaving</span>
          )}
        </div>
      </header>

      <section className="panel">
        <p className="label">They wrote</p>
        <p className="body-text">{item.body}</p>
      </section>

      {shotUrl && (
        <section className="panel">
          <p className="label">Screenshot</p>
          <a href={shotUrl} target="_blank" rel="noreferrer">
            <img
              src={shotUrl}
              alt="Screenshot attached by the owner"
              style={{
                maxWidth: '100%',
                borderRadius: 12,
                marginTop: 14,
                boxShadow: 'var(--shadow-rest)',
              }}
            />
          </a>
          <p className="faint" style={{ fontSize: 12, margin: '10px 0 0' }}>
            Link expires in five minutes.
          </p>
        </section>
      )}

      {!isLetter && item.diagnostics && <Diagnostics diagnostics={item.diagnostics} />}

      {item.replies.map((r) => (
        <section key={r.id} className="panel panel-reply">
          <div className="reply-rule" />
          <p className="label label-reply">
            You replied · {fullDate(r.createdAt)} · {r.readAt ? 'read' : 'not read yet'}
          </p>
          <p className="body-text" style={{ color: 'var(--navy)' }}>{r.body}</p>
        </section>
      ))}

      {error && <div className="notice notice-error">{error}</div>}

      {canReply ? (
        <section className="panel">
          <p className="label">{alreadyReplied ? 'Reply again' : 'Reply'}</p>
          <p className="faint" style={{ fontSize: 13, margin: '8px 0 0' }}>
            {isLetter
              ? 'This goes out unsigned, same as the letter itself, and letters get one reply. Write it as a person, not a template.'
              : 'This goes out as the Pawtchi team. They get a push and read it in the app.'}
          </p>
          <textarea
            className="composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isLetter ? 'Hi — Pra here…' : 'Thanks for flagging this…'}
            disabled={sending}
          />
          <div className="composer-actions">
            <button className="btn btn-primary" disabled={!draft.trim() || sending} onClick={submit}>
              {sending ? 'Sending…' : 'Send reply'}
            </button>
            <span className="faint" style={{ fontSize: 12.5 }}>
              Delivered on the next dispatch run, within 15 minutes.
            </span>
          </div>
        </section>
      ) : (
        <div className="notice notice-info">
          This letter has been answered. Letters get one reply on purpose — the exchange is a
          letter and an answer, not a thread.
        </div>
      )}
    </main>
  );
}

/**
 * The diagnostics the owner never had to type.
 *
 * Breadcrumbs are the valuable half: event names only, so there is nothing here
 * about what anyone logged or where they were. Errors are highlighted because a
 * repeated failure in the trail is usually the entire bug report.
 */
function Diagnostics({ diagnostics }) {
  const crumbs = Array.isArray(diagnostics.breadcrumbs) ? diagnostics.breadcrumbs : [];
  const rows = DIAG_FIELDS
    .map(([key, label]) => [label, diagValue(diagnostics[key])])
    .filter(([, v]) => v !== null);

  return (
    <section className="panel">
      <p className="label">What the app reported</p>

      {rows.length > 0 && (
        <dl className="diag">
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {crumbs.length > 0 && (
        <>
          <p className="label" style={{ marginTop: 28 }}>
            Last {crumbs.length} actions before they wrote in
          </p>
          <div className="crumbs">
            {crumbs.map((c, i) => {
              const isError = typeof c.e === 'string' && c.e.startsWith('app_error');
              return (
                <span key={i} className={`crumb${isError ? ' crumb-error' : ''}`}>
                  {c.e}{c.ctx ? ` · ${c.ctx}` : ''}
                </span>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';

import {
  createCreatorCode,
  fetchCreatorCodes,
  findUserIdByEmail,
  grantCreatorComp,
  linkCreatorAccount,
  setCreatorCodeActive,
} from '../lib/api';

/**
 * The entire management surface for the creator programme.
 *
 * Onboarding a creator is: add a row, click Comp, send them the code. No App
 * Store Connect, no Play Console, no build, no deploy. That was the design
 * constraint the whole feature was built around, and this page is where it
 * either holds or does not.
 *
 * ── The column that decides renewals ────────────────────────────────────────
 *
 * `Converted` — how many of a creator's redeemers went on to actually pay. It
 * costs nothing extra: it reads paywall_interaction_counters.ever_entitled_at,
 * which the app already maintains and which deliberately EXCLUDES promotional
 * entitlements. So it means "went on to pay us" rather than "received the free
 * months we gave them". Without that exclusion every creator would show 100%.
 *
 * ── Why there is no delete ──────────────────────────────────────────────────
 *
 * Deactivating stops a code being accepted and keeps the record of everyone we
 * gave access to. Deleting would orphan those redemptions and erase it.
 */
export default function Creators() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [composing, setComposing] = useState(false);
  const [busyCode, setBusyCode] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCodes(await fetchCreatorCodes());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const comp = async (code) => {
    setBusyCode(code);
    setError(null);
    setNotice(null);
    try {
      const until = await grantCreatorComp(code);
      setNotice(
        until
          ? `${code} now has Pawtchi Plus until ${new Date(until).toLocaleDateString()}.`
          : `${code} now has Pawtchi Plus.`,
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCode(null);
    }
  };

  // Completing the deliberate half-state: a code created before the creator
  // signed up. Without this the only way to finish the link was a hand-written
  // SQL statement, which is not a workflow.
  const link = async (code) => {
    const email = window.prompt(`Which Pawtchi account owns ${code}? Enter their email.`);
    if (!email) return;
    setBusyCode(code);
    setError(null);
    setNotice(null);
    try {
      await linkCreatorAccount(code, email.trim());
      setNotice(`${code} is now linked to ${email.trim()}. They can see it in their Profile, and Comp is available.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCode(null);
    }
  };

  const toggle = async (code, next) => {
    setBusyCode(code);
    setError(null);
    try {
      await setCreatorCodeActive(code, next);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCode(null);
    }
  };

  const live = codes.filter((c) => c.isActive).length;
  const redeemed = codes.reduce((n, c) => n + c.redemptionsGranted, 0);

  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Creators</p>
        <h1 className="display">{codes.length === 0 ? 'NO CODES YET' : `${live} LIVE`}</h1>
        <p className="sub">
          {codes.length === 0
            ? 'Add a code to start a collaboration.'
            : `${redeemed} ${redeemed === 1 ? 'person has' : 'people have'} redeemed a code.`}
        </p>
      </header>

      <div className="filters">
        <button className="chip" aria-pressed={composing} onClick={() => setComposing((v) => !v)}>
          {composing ? 'Cancel' : 'New code'}
        </button>
        <span style={{ flex: 1 }} />
        <button className="chip" onClick={load}>Refresh</button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {notice && <div className="notice notice-info">{notice}</div>}

      {composing && (
        <NewCodeForm
          onCancel={() => setComposing(false)}
          onSaved={async () => {
            setComposing(false);
            await load();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <div className="spinner" aria-label="Loading" />
      ) : codes.length === 0 ? (
        <div className="card empty">
          No creator codes yet. A code, a comp, and the creator is ready to film.
        </div>
      ) : (
        <div className="rows">
          {codes.map((c) => (
            <CodeRow
              key={c.code}
              item={c}
              busy={busyCode === c.code}
              onComp={() => comp(c.code)}
              onLink={() => link(c.code)}
              onToggle={() => toggle(c.code, !c.isActive)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function CodeRow({ item, busy, onComp, onLink, onToggle }) {
  const comped = item.compExpiresAt && new Date(item.compExpiresAt) > new Date();

  const meta = [
    item.creatorEmail ?? (item.creatorOwnerId ? 'account linked' : 'no account linked yet'),
    item.maxRedemptions ? `cap ${item.maxRedemptions}` : 'uncapped',
    item.duration.replace(/_/g, ' '),
    // Only shown when non-zero. A permanent "0 failed" on every row trains the
    // eye to skip the column that matters when it is not zero.
    item.redemptionsFailed > 0 ? `${item.redemptionsFailed} failed` : null,
    comped ? 'comped' : 'not comped',
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="row" style={{ cursor: 'default' }}>
      <span
        className={`status${item.isActive ? '' : ' status-answered'}`}
        aria-label={item.isActive ? 'Live' : 'Paused'}
      />

      <div className="row-body">
        <div className="row-top">
          <span className="badge badge-letter">{item.code}</span>
          <span className="row-text" style={{ fontWeight: 700 }}>
            {item.creatorName}
            {item.creatorHandle ? ` · ${item.creatorHandle}` : ''}
          </span>
          <span className="row-age">
            {item.redemptionsGranted} redeemed · {item.convertedToPaid} converted
          </span>
        </div>
        <div className="row-meta">{meta}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {/* Shown only while the code has no account. A permanent button here
            would invite re-pointing a live code at a different person, which
            would hand them someone else's redemption history. */}
        {!item.creatorOwnerId && (
          <button className="btn btn-ghost btn-sm" onClick={onLink} disabled={busy}>
            Link account
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={onComp}
          disabled={busy || !item.creatorOwnerId}
          title={
            item.creatorOwnerId
              ? 'Gives this creator a year of Pawtchi Plus so they can film the paid features'
              : 'Link their Pawtchi account to the code first'
          }
        >
          {comped ? 'Re-comp' : 'Comp'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onToggle} disabled={busy}>
          {item.isActive ? 'Pause' : 'Resume'}
        </button>
      </div>
    </div>
  );
}

/**
 * The email field is optional on purpose.
 *
 * Deals are agreed before the creator has signed up, so a form that demands an
 * account would either block the code being created or push someone into
 * inventing one. Unlinked is a real, expected state: the code works for the
 * audience immediately, and the creator's own screen and comp light up once the
 * email is added.
 */
function NewCodeForm({ onCancel, onSaved, onError }) {
  const [code, setCode] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [creatorHandle, setCreatorHandle] = useState('');
  const [email, setEmail] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || !creatorName.trim()) return;
    setSaving(true);
    onError(null);
    try {
      let ownerId = null;
      if (email.trim()) {
        ownerId = await findUserIdByEmail(email.trim());
        if (!ownerId) {
          onError(
            `No Pawtchi account for ${email.trim()}. Create the code without it and link them once they sign up.`,
          );
          setSaving(false);
          return;
        }
      }
      await createCreatorCode({
        code,
        creatorName: creatorName.trim(),
        creatorHandle: creatorHandle.trim(),
        creatorOwnerId: ownerId,
        maxRedemptions,
      });
      await onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card card-pad" style={{ marginBottom: 20 }} onSubmit={submit}>
      <label className="field">
        <span>Code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
          placeholder="SARAHK"
          maxLength={24}
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Creator name</span>
        <input
          value={creatorName}
          onChange={(e) => setCreatorName(e.target.value)}
          placeholder="Sarah"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Handle (optional)</span>
        <input
          value={creatorHandle}
          onChange={(e) => setCreatorHandle(e.target.value)}
          placeholder="@sarahwalksdogs"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Their Pawtchi email (optional — link it later if they have not signed up)</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="sarah@example.com"
          type="email"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Redemption cap (optional — blank means uncapped)</span>
        <input
          value={maxRedemptions}
          onChange={(e) => setMaxRedemptions(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="500"
          inputMode="numeric"
          autoComplete="off"
        />
      </label>

      <p className="muted" style={{ fontSize: 13, margin: '0 0 18px' }}>
        Every code grants three months. Change the duration in the database if a
        collaboration needs different terms.
      </p>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving' : 'Create code'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

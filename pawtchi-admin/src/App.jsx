import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';

import { supabase } from './lib/supabase';
import { isAdmin } from './lib/api';
import Login from './pages/Login.jsx';
import Inbox from './pages/Inbox.jsx';
import Thread from './pages/Thread.jsx';
import Creators from './pages/Creators.jsx';

/**
 * Auth shell.
 *
 * Two distinct states that must not be collapsed: signed out, and signed in but
 * not an admin. The second one gets its own screen rather than a redirect to
 * login, because bouncing someone back to a form they just filled in correctly
 * reads as "wrong password" and sends them round the loop again.
 *
 * Neither state is the security boundary. RLS is — a non-admin who bypassed
 * this entirely would still read nothing, because `admin_users` decides what
 * PostgREST returns. This is only here so the tool is honest about why it is
 * empty.
 */
export default function App() {
  const [session, setSession] = useState(null);
  const [admin, setAdmin] = useState(null); // null = not yet checked
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  const check = useCallback(async (s) => {
    if (!s) {
      setAdmin(null);
      return;
    }
    setAdmin(await isAdmin());
  }, []);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session ?? null);
      await check(data.session ?? null);
      if (alive) setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!alive) return;
      setSession(s);
      await check(s);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [check]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  };

  if (!ready) return <div className="spinner" aria-label="Loading" />;

  if (!session) return <Login />;

  if (admin === false) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <p className="eyebrow">No access</p>
          <h1 className="display" style={{ fontSize: 32, margin: '16px 0 12px' }}>
            NOT ON THE ADMIN LIST
          </h1>
          <p className="muted" style={{ margin: '0 0 24px' }}>
            You are signed in as <strong>{session.user.email}</strong>, but this account is not
            allowed to read support requests. Access is granted from the database, not from here.
          </p>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">PAWTCHI</span>
        <span className="topbar-tag">admin</span>
        {/* Two tools, one shell. These sit before the spacer so they read as
            navigation rather than as more account controls. */}
        <NavLink to="/" end className="topbar-link">Inbox</NavLink>
        <NavLink to="/creators" className="topbar-link">Creators</NavLink>
        <span className="topbar-spacer" />
        <span className="topbar-user">{session.user.email}</span>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
      </header>

      <Routes>
        <Route path="/" element={<Inbox />} />
        <Route path="/creators" element={<Creators />} />
        <Route path="/:kind/:id" element={<Thread />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

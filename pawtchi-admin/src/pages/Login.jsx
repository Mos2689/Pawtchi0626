import { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Email + password against the same Supabase Auth the app uses, so there is no
 * second identity system to keep in step. Being able to sign in proves nothing
 * on its own — every Pawtchi owner can — the `admin_users` allowlist is what
 * decides whether anything is visible afterwards.
 *
 * The failure copy stays vague on purpose: "that did not match" rather than
 * "no such user", so this form cannot be used to test whether an address has an
 * account.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError('That email and password did not match.');
      setBusy(false);
    }
    // On success the auth listener in App swaps this screen out.
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <p className="eyebrow">Pawtchi</p>
        <h1 className="display" style={{ fontSize: 38, margin: '16px 0 8px' }}>
          ADMIN
        </h1>
        <p className="muted" style={{ margin: '0 0 28px', fontSize: 14.5 }}>
          Support requests and letters from the people who use Pawtchi.
        </p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && (
          <div className="notice notice-error" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={busy || !email.trim() || !password}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

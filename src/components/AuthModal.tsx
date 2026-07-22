import { useState } from "react";
import type { User } from "../types";
import { api } from "../api/client";
import { IS_MOCK } from "../config";
import { Turnstile } from "./Turnstile";

// Magic-link auth (TASKS.md §7). Requires Turnstile before requesting the link
// (§2/§7 — magic-link endpoint is Turnstile+rate-limited server-side too). In
// mock mode we can simulate clicking the emailed link; in real mode the user
// clicks the link in their inbox, which lands on /?token=… (handled in App).

interface Props {
  onClose: () => void;
  onAuthed: (user: User) => void;
}

type Step = "email" | "sent";

export function AuthModal({ onClose, onAuthed }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [tsToken, setTsToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

  async function requestLink() {
    if (!emailValid) return setErr("Enter a valid email");
    if (!tsToken) return setErr("Complete the verification first");
    setBusy(true);
    setErr(null);
    try {
      await api.requestMagicLink(email, tsToken);
      setStep("sent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(tok: string) {
    setBusy(true);
    setErr(null);
    try {
      const user = await api.verifyMagicLink(tok.trim());
      onAuthed(user);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function simulateClick() {
    const peek = (api as { devPeekToken?: (e: string) => Promise<string | null> }).devPeekToken;
    const tok = peek ? await peek(email) : null;
    if (tok) await verify(tok);
    else setErr("No pending link found");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {step === "email" ? (
          <>
            <h2>Join the crawl 🍺</h2>
            <p className="sub">
              We'll email you a magic link — no password. Sessions are cookie-based.
            </p>
            {err && <p className="err">{err}</p>}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && requestLink()}
              />
            </div>
            <Turnstile onToken={setTsToken} />
            <div className="actions">
              <button className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={requestLink} disabled={busy || !emailValid || !tsToken}>
                {busy ? "Sending…" : "Send magic link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Check your inbox 📬</h2>
            <p className="sub">
              We sent a single-use link to <b>{email}</b>. It expires in 15 minutes.
            </p>
            {err && <p className="err">{err}</p>}
            {IS_MOCK ? (
              <>
                <button className="btn primary" style={{ width: "100%" }} onClick={simulateClick} disabled={busy}>
                  {busy ? "Signing in…" : "Simulate opening the link"}
                </button>
                <p className="hint">
                  Mock mode: the token was also logged to the console. In production this button
                  doesn't exist — you'd click the link in your email.
                </p>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="tok">Paste the link token (dev)</label>
                  <input
                    id="tok"
                    className="input"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="token from the email URL"
                  />
                </div>
                <button className="btn primary" style={{ width: "100%" }} onClick={() => verify(token)} disabled={busy || !token}>
                  {busy ? "Signing in…" : "Verify"}
                </button>
              </>
            )}
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setStep("email")}>
                ← Use a different email
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

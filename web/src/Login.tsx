import { useState, type FormEvent, type ReactElement } from "react";
import { api } from "./api";
export function Login({
  onLogin,
  notice,
}: {
  onLogin: () => void;
  notice?: string;
}): ReactElement {
  const [register, setRegister] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const result = await api<{ token: string }>(
        register ? "/auth/register" : "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      localStorage.setItem("token", result.token);
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in");
    }
  }
  async function requestReset(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResetSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request a reset");
    }
  }
  if (forgot) {
    return (
      <main className="login">
        <form onSubmit={requestReset}>
          <h1>Reset password</h1>
          <p>Enter your email and we’ll send a reset link if it is registered.</p>
          <input
            aria-label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
          />
          <button>Send reset link</button>
          {resetSent && (
            <p className="success">
              If that email is registered, a reset link is on its way.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <button type="button" className="link" onClick={() => setForgot(false)}>
            Back to login
          </button>
        </form>
      </main>
    );
  }
  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Syncbook</h1>
        {notice && <p className="success">{notice}</p>}
        <input
          aria-label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          required
        />
        <input
          aria-label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          minLength={8}
          required
        />
        <button>{register ? "Create account" : "Log in"}</button>
        {error && <p className="error">{error}</p>}
        {!register && (
          <button type="button" className="link" onClick={() => setForgot(true)}>
            Forgot password?
          </button>
        )}
        <button type="button" className="link" onClick={() => setRegister(!register)}>
          {register ? "Already registered?" : "Create an account"}
        </button>
      </form>
    </main>
  );
}

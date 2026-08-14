import { useState, type FormEvent, type ReactElement } from "react";
import { api } from "./api";
export function Login({ onLogin }: { onLogin: () => void }): ReactElement {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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
  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Syncbook</h1>
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
        <button type="button" className="link" onClick={() => setRegister(!register)}>
          {register ? "Already registered?" : "Create an account"}
        </button>
      </form>
    </main>
  );
}

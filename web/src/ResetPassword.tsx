import { useState, type FormEvent, type ReactElement } from "react";
import { api } from "./api";

export function ResetPassword({
  token,
  onComplete,
}: {
  token: string;
  onComplete: () => void;
}): ReactElement {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Passwords do not match");
      return;
    }
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reset password");
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Choose a new password</h1>
        <input
          aria-label="New password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="New password"
          minLength={8}
          required
        />
        <input
          aria-label="Confirm new password"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="Confirm new password"
          minLength={8}
          required
        />
        <button>Reset password</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

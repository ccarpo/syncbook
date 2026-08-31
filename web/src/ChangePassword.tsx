import { useState, type FormEvent, type ReactElement } from "react";
import { api } from "./api";

export function ChangePassword(): ReactElement {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const result = await api<{ token: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      localStorage.setItem("token", result.token);
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("Password changed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change password");
    }
  }

  return (
    <>
      <button onClick={() => setOpen((current) => !current)}>Change password</button>
      {open && (
        <form className="password-panel" onSubmit={submit}>
          <input
            aria-label="Current password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Current password"
            required
          />
          <input
            aria-label="New password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="New password"
            minLength={8}
            required
          />
          <button>Save password</button>
          {success && <p className="success">{success}</p>}
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </>
  );
}

import React, { FormEvent, useState } from "react";

export function LoginView({
  error,
  loading,
  onSubmit,
}: {
  error: string | null;
  loading: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(password);
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>OpenCode Controller</h1>
        <p>Single-password access</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter password"
          autoComplete="current-password"
        />
        <button disabled={loading} type="submit">
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {error ? <span className="error">{error}</span> : null}
      </form>
    </div>
  );
}

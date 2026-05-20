import React from "react";

export function ChatTransitionStrip({
  tone,
  label,
  detail,
}: {
  tone: "idle" | "info" | "warn";
  label: string;
  detail: string;
}) {
  return (
    <div className={`chat-transition-strip ${tone}`} role="status" aria-live="polite">
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  );
}

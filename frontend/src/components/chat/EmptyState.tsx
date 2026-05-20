import React from "react";
import { ChatStateCard } from "./ChatStateCard";

export function EmptyState() {
  return (
    <ChatStateCard
      title="This session is ready."
      detail="Send a prompt to start, then use the Stop button in the composer if you need to interrupt a run."
    />
  );
}

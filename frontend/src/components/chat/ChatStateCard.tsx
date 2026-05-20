import React from "react";

export function ChatStateCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-pill">
        <p>{title}</p>
        <small>{detail}</small>
      </div>
    </div>
  );
}

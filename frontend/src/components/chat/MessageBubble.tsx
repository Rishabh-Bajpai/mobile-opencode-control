import React from "react";
import type { ChatMessage } from "../../types";
import { buildMessageStableKey } from "../../utils/messageUtils";
import { MessageParts, CollapsedMessageParts } from "./MessageParts";
import { RichMessageText } from "./RichMessageText";

export function MessageBubble({
  message,
  canSpeak,
  speaking,
  attachedTop,
  attachedBottom,
  showParts,
  collapseParts,
  onSpeak,
  activityOpen,
  onActivityToggle,
  expandedParts,
  onPartToggle,
}: {
  message: ChatMessage;
  canSpeak: boolean;
  speaking: boolean;
  attachedTop: boolean;
  attachedBottom: boolean;
  showParts: boolean;
  collapseParts: boolean;
  onSpeak: (message: ChatMessage) => void;
  activityOpen: boolean;
  onActivityToggle: (nextOpen: boolean) => void;
  expandedParts: Record<string, boolean>;
  onPartToggle: (partKey: string, nextOpen: boolean) => void;
}) {
  const own = message.role === "user";
  const timestamp = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div
      className={`message-row ${own ? "own" : "other"} ${attachedTop ? "attached-top" : ""} ${attachedBottom ? "attached-bottom" : ""}`}
    >
      <article
        className={`bubble ${own ? "own" : "other"} ${attachedTop ? "attached-top" : ""} ${attachedBottom ? "attached-bottom" : ""}`}
      >
        {canSpeak ? (
          <button type="button" className="speak-button" onClick={() => onSpeak(message)}>
            {speaking ? "Playing..." : "Play"}
          </button>
        ) : null}
        <RichMessageText text={message.text} />
        {showParts ? (
          collapseParts ? (
            <CollapsedMessageParts
              parts={message.parts}
              groupOpen={activityOpen}
              onGroupToggle={onActivityToggle}
              partScope={`message:${buildMessageStableKey(message)}`}
              expandedParts={expandedParts}
              onPartToggle={onPartToggle}
            />
          ) : (
            <MessageParts
              parts={message.parts}
              partScope={`message:${buildMessageStableKey(message)}`}
              expandedParts={expandedParts}
              onPartToggle={onPartToggle}
            />
          )
        ) : null}
        <small>{timestamp}</small>
      </article>
    </div>
  );
}

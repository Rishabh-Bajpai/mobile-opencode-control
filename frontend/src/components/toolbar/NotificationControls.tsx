import React from "react";
import type { NotificationChannel } from "../../types";

export function NotificationControls({
  supported,
  enabled,
  permission,
  channel,
  ntfyTopicUrl,
  saving,
  testing,
  onEnable,
  onDisable,
  onChannelChange,
  onNtfyTopicUrlChange,
  onSaveSettings,
  onTestNtfy,
}: {
  supported: boolean;
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  channel: NotificationChannel;
  ntfyTopicUrl: string;
  saving: boolean;
  testing: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onChannelChange: (value: NotificationChannel) => void;
  onNtfyTopicUrlChange: (value: string) => void;
  onSaveSettings: () => void;
  onTestNtfy: () => void;
}) {
  const statusLabel = !supported
    ? "Browser notifications are not supported here."
    : !enabled
    ? "Notifications are off."
    : permission === "granted"
    ? "Notifications are on for final agent replies."
    : permission === "denied"
    ? "Browser permission is blocked. Enable it in site settings."
    : "Notifications will turn on after browser permission is granted.";

  return (
    <div className="notification-controls">
      <div className="toolbar-card-head">
        <strong>Notifications</strong>
        <span>Final agent replies in the background</span>
      </div>
      <small>{statusLabel}</small>
      <label>
        <span>Delivery channel</span>
        <select value={channel} onChange={(event) => onChannelChange(event.currentTarget.value as NotificationChannel)}>
          <option value="browser">Browser</option>
          <option value="ntfy">ntfy</option>
          <option value="both">Both</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label>
        <span>ntfy topic URL</span>
        <input
          value={ntfyTopicUrl}
          onChange={(event) => onNtfyTopicUrlChange(event.currentTarget.value)}
          placeholder="https://ntfy.example.com/topic"
        />
      </label>
      <div className="notification-actions">
        <button type="button" className="secondary-button" onClick={onEnable} disabled={!supported || enabled}>
          Turn on
        </button>
        <button type="button" className="secondary-button" onClick={onDisable} disabled={!enabled}>
          Turn off
        </button>
        <button type="button" className="secondary-button" onClick={onSaveSettings} disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </button>
        <button type="button" className="secondary-button" onClick={onTestNtfy} disabled={testing || !ntfyTopicUrl.trim()}>
          {testing ? "Testing..." : "Test ntfy"}
        </button>
      </div>
    </div>
  );
}

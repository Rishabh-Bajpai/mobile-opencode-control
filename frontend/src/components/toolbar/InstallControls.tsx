import React from "react";

export function InstallControls({
  canInstall,
  installed,
  installMessage,
  installing,
  onInstall,
}: {
  canInstall: boolean;
  installed: boolean;
  installMessage: string;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="install-controls">
      <div className="toolbar-card-head">
        <strong>Install App</strong>
        <span>Standalone launch and offline shell</span>
      </div>
      <small>{installMessage}</small>
      {!installed && canInstall ? (
        <div className="notification-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? "Opening..." : "Install"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

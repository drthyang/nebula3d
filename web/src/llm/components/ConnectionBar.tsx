// The compact connection control: a status indicator light, the model selector,
// and a gear that toggles the settings drawer.  Everything else (provider, base
// URL, API key, vision opt-in) is folded into ConnectionSettings so the resting
// state stays clean and sleek.

import { IconGear } from "../../components/ui";
import { saveSettings, type LlmSettings } from "../settings";
import type { ConnectionState } from "../useAssistant";

export function ConnectionBar({
  settings,
  connection,
  settingsOpen,
  onToggleSettings,
}: {
  settings: LlmSettings;
  connection: ConnectionState;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const dotClass =
    connection.status === "ok" ? "ok" : connection.status === "testing" ? "testing" : "down";
  const statusLabel =
    connection.status === "ok"
      ? "Connected"
      : connection.status === "testing"
        ? "Connecting…"
        : connection.status === "error"
          ? "Offline"
          : "Not connected";

  return (
    <div className="ai-conn-bar">
      <span className={`ai-conn-status ${dotClass}`} title={connection.error ?? statusLabel}>
        <span className="api-dot" />
        {statusLabel}
      </span>

      <div className="ai-conn-model">
        <select
          value={settings.model}
          onChange={(e) => saveSettings({ model: e.target.value })}
          disabled={!connection.models.length}
          aria-label="Model"
        >
          {!connection.models.length && <option value="">No model</option>}
          {connection.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className={`ai-gear${settingsOpen ? " on" : ""}`}
        onClick={onToggleSettings}
        aria-expanded={settingsOpen}
        title="Connection settings"
      >
        <IconGear />
      </button>
    </div>
  );
}

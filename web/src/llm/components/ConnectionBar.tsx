// The compact connection control: a status indicator light, a provider badge
// (Ollama / LM Studio / OpenAI / Gemini), and a gear on the right that toggles
// the settings drawer.  The model selector lives down by the composer, LLM-app
// style; everything else is folded into ConnectionSettings.

import { IconGear } from "../../components/ui";
import { providerForUrl } from "../provider/presets";
import type { LlmSettings } from "../settings";
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
  const preset = providerForUrl(settings.baseUrl);
  const providerLabel = preset?.label ?? "Custom";
  const isCloud = preset?.cloud ?? false;
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

      <span className={`ai-provider-badge${isCloud ? " cloud" : ""}`}>{providerLabel}</span>

      <button
        type="button"
        className={`ai-gear${settingsOpen ? " on" : ""}`}
        onClick={onToggleSettings}
        aria-expanded={settingsOpen}
        title="Connection settings"
        aria-label="Connection settings"
      >
        <IconGear />
      </button>
    </div>
  );
}

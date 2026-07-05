// The connection settings drawer, revealed by the gear on ConnectionBar.  Holds
// everything the compact bar hides: provider preset, base URL, API key (cloud
// only), the Test button, the vision opt-in, and the connection hint/warning.

import { Field, Switch } from "../../components/ui";
import { isLocalUrl, PROVIDER_PRESETS, providerForUrl } from "../provider/presets";
import { saveSettings, type LlmSettings } from "../settings";
import type { ConnectionState } from "../useAssistant";

export function ConnectionSettings({
  settings,
  connection,
  onTest,
}: {
  settings: LlmSettings;
  connection: ConnectionState;
  onTest: () => void;
}) {
  const preset = providerForUrl(settings.baseUrl);
  const isCloud = preset ? preset.cloud : !isLocalUrl(settings.baseUrl);

  return (
    <div className="ai-settings">
      <div className="ai-settings-row">
        <Field label="Provider">
          <select
            value={preset?.baseUrl ?? settings.baseUrl}
            onChange={(e) => saveSettings({ baseUrl: e.target.value, model: "" })}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.baseUrl}>
                {p.label}
                {p.cloud ? " (cloud)" : ""}
              </option>
            ))}
            {!preset && <option value={settings.baseUrl}>Custom</option>}
          </select>
        </Field>

        <Field label="Base URL" grow>
          <input
            type="text"
            className="ai-conn-url"
            value={settings.baseUrl}
            spellCheck={false}
            onChange={(e) => saveSettings({ baseUrl: e.target.value })}
          />
        </Field>

        <button type="button" className="ai-btn" onClick={onTest}>
          {connection.status === "testing" ? "Testing…" : "Test"}
        </button>
      </div>

      {isCloud && (
        <div className="ai-settings-row">
          <Field
            label={
              <>
                API key{" "}
                {preset?.keyUrl && (
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer noopener">
                    (get one)
                  </a>
                )}
              </>
            }
            grow
          >
            <input
              type="password"
              className="ai-conn-url"
              value={settings.apiKey}
              placeholder="sk-…"
              spellCheck={false}
              onChange={(e) => saveSettings({ apiKey: e.target.value })}
            />
          </Field>
        </div>
      )}

      <div className="ai-settings-toggle">
        <Switch
          label="Attach slice image (vision models)"
          checked={settings.attachImages}
          onChange={(b) => saveSettings({ attachImages: b })}
        />
        <span className="ai-hint">
          {settings.attachImages
            ? "The rendered slice is sent with stage reviews so a vision model can assess the image."
            : "Off: only computed metrics are sent (works with any text model)."}
        </span>
      </div>

      {connection.status === "error" && (connection.hint || connection.error) && (
        <div className="ai-conn-alert">{connection.hint || connection.error}</div>
      )}
      {isCloud && (
        <div className="ai-conn-warn">
          Cloud provider: run-derived metrics{settings.attachImages ? " and the rendered slice" : ""} are sent off your
          device. {preset?.hint}
        </div>
      )}
    </div>
  );
}

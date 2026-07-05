// Model connection controls, styled as a shared control cluster (.qr-cluster) to
// match the other viewer pages.  Local presets (Ollama, LM Studio) need no key
// and keep data on-device; cloud presets (OpenAI, Gemini) collect a Bearer key
// and surface a data-leaves-device warning.  All state lives in the localStorage
// settings store.

import { Field, Switch } from "../../components/ui";
import { isLocalUrl, PROVIDER_PRESETS, providerForUrl } from "../provider/presets";
import { saveSettings, type LlmSettings } from "../settings";
import type { ConnectionState } from "../useAssistant";

export function ConnectionBar({
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
  const dotClass =
    connection.status === "ok" ? "ok" : connection.status === "testing" ? "testing" : "down";

  return (
    <div className="qr-cluster ai-conn">
      <div className="qr-cluster-head">
        <span className="qr-cluster-title">Model connection</span>
        <span className={`ai-conn-status ${dotClass}`}>
          <span className="api-dot" />
          {connection.status === "ok"
            ? `connected · ${connection.models.length} model${connection.models.length === 1 ? "" : "s"}`
            : connection.status === "testing"
              ? "probing…"
              : connection.status === "error"
                ? "no connection"
                : "not tested"}
        </span>
      </div>

      <div className="qr-cluster-controls ai-conn-controls">
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

        <Field label="Model">
          <select
            value={settings.model}
            onChange={(e) => saveSettings({ model: e.target.value })}
            disabled={!connection.models.length}
          >
            {!connection.models.length && <option value="">—</option>}
            {connection.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <button type="button" className="ai-btn" onClick={onTest}>
          {connection.status === "testing" ? "Testing…" : "Test"}
        </button>

        {isCloud && (
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
        )}
      </div>

      <div className="ai-conn-foot">
        <div className="ai-conn-toggle">
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

        {connection.status === "error" && connection.manual && (connection.hint || connection.error) && (
          <div className="ai-conn-alert">{connection.hint || connection.error}</div>
        )}
        {isCloud && (
          <div className="ai-conn-warn">
            Cloud provider: run-derived metrics{settings.attachImages ? " and the rendered slice" : ""} are sent off your
            device. {preset?.hint}
          </div>
        )}
      </div>
    </div>
  );
}

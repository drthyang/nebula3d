// The connection settings drawer, revealed by the gear on ConnectionBar.  Holds
// everything the compact bar hides: provider preset, base URL, API key (cloud
// only), the Test button, the vision opt-in, and the connection hint/warning.

import { Field, Switch } from "../../components/ui";
import { isLocalUrl, PROVIDER_PRESETS, providerForUrl } from "../provider/presets";
import { saveSettings, type LlmSettings } from "../settings";
import type { ConnectionState } from "../useAssistant";

const origin = typeof window !== "undefined" ? window.location.origin : "this page";

// Concise, click-to-expand setup guide.  The key gotcha for a browser app is
// CORS: a local model server must allow this page's origin before it will answer
// fetch() calls from here.
function HelpConnect() {
  return (
    <details className="ai-help">
      <summary>
        <span className="ai-help-q">?</span> How to connect a model
      </summary>
      <div className="ai-help-body">
        <p>
          This app runs in your browser, so a local model server must <b>allow this page's origin
          (CORS)</b>. This page is <code>{origin}</code>.
        </p>

        <p className="ai-help-h">Ollama — local &amp; private</p>
        <ol>
          <li>
            Pull a model: <code>ollama pull llama3.2</code> (or a vision model like{" "}
            <code>llama3.2-vision</code>).
          </li>
          <li>
            Start it allowing this site:
            <code className="ai-help-cmd">OLLAMA_ORIGINS="{origin}" ollama serve</code>
            (or <code>OLLAMA_ORIGINS="*"</code> to allow any site).
          </li>
          <li>
            Base URL: <code>http://localhost:11434/v1</code>.
          </li>
        </ol>

        <p className="ai-help-h">LM Studio — local &amp; private</p>
        <ol>
          <li>Load a model, open the <b>Developer</b> (Local Server) tab.</li>
          <li>Turn on <b>Enable CORS</b>, then Start Server.</li>
          <li>
            Base URL: <code>http://localhost:1234/v1</code>.
          </li>
        </ol>

        <p className="ai-help-h">Cloud — OpenAI / Gemini</p>
        <p>Pick the provider below and paste an API key. Your run data leaves your device.</p>

        <p className="ai-help-note">
          Use Chrome, Edge, or Firefox — Safari blocks <code>http://localhost</code> from an https
          page. Then click <b>Test</b>.
        </p>
      </div>
    </details>
  );
}

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

      <HelpConnect />
    </div>
  );
}

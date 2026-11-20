- **NEBULA Pilot: one API key per provider.** The connection settings kept
  one key for every provider, so a key saved for one was sent to the next
  one after a provider switch, a local server included, and to each
  half-typed host while a custom Base URL was typed. Each key is now saved
  for the server of the Base URL it was typed with (`https://api.openai.com`)
  and sent to that server only.
  - Switching provider shows that provider's own key, or an empty field;
    switching back shows the first key again.
  - A local server (`localhost`) and a Base URL that is not complete are sent
    no key.
  - A key saved before this version is assigned once, by how it begins:
    `sk-ant-` to Anthropic, `AIza` to Gemini, `sk-proj-` or `sk-svcacct-` to
    OpenAI. Any other key stays with the Base URL that was set; it is removed
    when that is a local server, or Anthropic or Gemini (it is not one of
    their keys). Check the **API key** field after updating.
  - More in `docs/pilot-setup.md`, "Where the settings are kept".

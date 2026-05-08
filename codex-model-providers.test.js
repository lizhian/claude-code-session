const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  authFromProvider,
  loadCodexPermissionMode,
  loadModelProviders,
  parseTomlProviders,
  parseTopLevelModelProvider,
  parseTopLevelModelProviderSelected,
  parseTopLevelPermissionModeSelected,
  saveCodexPermissionMode,
  selectModelProvider,
  unknownProviderName,
} = require("./codex/codex-model-providers");

function writeConfig(codexHome, text) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), text);
}

function writeAuth(codexHome, auth) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "auth.json"), `${JSON.stringify(auth, null, 2)}\n`);
}

test("parses Codex model providers including quoted names and multiline auth_json", () => {
  const parsed = parseTomlProviders(
    [
      "model = \"gpt-5\"",
      "model_provider = \"openai-compatible\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{\"OPENAI_API_KEY\":\"default-key\"}'''",
      "",
      "[model_providers.\"openai-compatible\"]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''",
      "{\"OPENAI_API_KEY\":\"custom-key\"}",
      "'''",
      "",
    ].join("\n"),
  );

  assert.equal(parsed.selectedProviderName, "openai-compatible");
  assert.equal(parsed.providers.length, 2);
  assert.equal(parsed.providers[0].name, "openai");
  assert.deepEqual(parsed.providers[0].config, { auth_json: "{\"OPENAI_API_KEY\":\"default-key\"}" });
  assert.equal(parsed.providers[1].name, "openai-compatible");
  assert.equal(parsed.providers[1].config.base_url, "https://api.example.com/v1");
  assert.equal(parsed.providers[1].config.auth_json, "{\"OPENAI_API_KEY\":\"custom-key\"}\n");
});

test("detects selected provider from model_provider_selected before model_provider", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-selected-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "model_provider = \"custom\"",
      "model_provider_selected = \"openai\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{}'''",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{}'''",
      "",
    ].join("\n"),
  );

  const { providers } = loadModelProviders(codexHome);

  assert.equal(providers.find((provider) => provider.name === "openai").selected, true);
  assert.equal(providers.find((provider) => provider.name === "custom").selected, false);
});

test("does not infer a selected provider when selected fields are absent", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-default-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{}'''",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{}'''",
      "",
    ].join("\n"),
  );

  const { providers } = loadModelProviders(codexHome);

  assert.equal(providers.find((provider) => provider.name === "openai").selected, false);
  assert.equal(providers.find((provider) => provider.name === "custom").selected, false);
});

test("selects a base_url provider after backing up current auth to selected provider", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-select-custom-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "model_provider_selected = \"openai\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{\"OPENAI_API_KEY\":\"default-key\"}'''",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{\"OPENAI_API_KEY\":\"custom-key\"}'''",
      "",
    ].join("\n"),
  );
  writeAuth(codexHome, {
    OPENAI_API_KEY: "fresh-default-key",
    last_refresh: "2026-05-08T01:00:00.000Z",
    access_token: "fresh-access-token",
    refresh_token: "fresh-refresh-token",
  });

  const result = selectModelProvider("custom", codexHome);
  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));

  assert.equal(result.provider.name, "custom");
  assert.match(config, /model_provider = "custom"/);
  assert.match(config, /model_provider_selected = "custom"/);
  assert.match(config, /"last_refresh": "2026-05-08T01:00:00.000Z"/);
  assert.match(config, /"access_token": "fresh-access-token"/);
  assert.match(config, /"refresh_token": "fresh-refresh-token"/);
  assert.deepEqual(auth, { OPENAI_API_KEY: "custom-key" });
});

test("selects the default provider by removing top-level model_provider", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-select-default-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "model_provider = \"custom\"",
      "model_provider_selected = \"custom\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{\"OPENAI_API_KEY\":\"default-key\"}'''",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{\"OPENAI_API_KEY\":\"custom-key\"}'''",
      "",
    ].join("\n"),
  );
  writeAuth(codexHome, { OPENAI_API_KEY: "fresh-custom-key" });

  selectModelProvider("openai", codexHome);

  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));
  assert.doesNotMatch(config, /^model_provider\s*=/m);
  assert.match(config, /^model_provider_selected = "openai"$/m);
  assert.match(config, /"OPENAI_API_KEY": "fresh-custom-key"/);
  assert.deepEqual(auth, { OPENAI_API_KEY: "default-key" });
});

test("creates an unknown provider for current auth when no selected provider is known", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-select-unknown-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{\"OPENAI_API_KEY\":\"custom-key\"}'''",
      "",
    ].join("\n"),
  );
  writeAuth(codexHome, {
    OPENAI_API_KEY: "unknown-current-key",
    access_token: "unknown-access-token",
  });

  const result = selectModelProvider("custom", codexHome, { now: new Date("2026-05-08T01:02:03") });
  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));

  assert.equal(result.previousProviderName, "unknown-20260508-010203");
  assert.match(config, /^model_provider = "custom"$/m);
  assert.match(config, /^model_provider_selected = "custom"$/m);
  assert.match(config, /\[model_providers\."unknown-20260508-010203"\]/);
  assert.match(config, /^name = "unknown-20260508-010203"$/m);
  assert.match(config, /"access_token": "unknown-access-token"/);
  assert.deepEqual(auth, { OPENAI_API_KEY: "custom-key" });
});

test("selecting the current provider only updates provider auth from auth.json", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-sync-current-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "model_provider_selected = \"openai\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{\"OPENAI_API_KEY\":\"stale-key\"}'''",
      "",
    ].join("\n"),
  );
  writeAuth(codexHome, { OPENAI_API_KEY: "fresh-key", last_refresh: "fresh-refresh" });

  const result = selectModelProvider("openai", codexHome);
  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));

  assert.equal(result.sameProvider, true);
  assert.match(config, /"OPENAI_API_KEY": "fresh-key"/);
  assert.match(config, /"last_refresh": "fresh-refresh"/);
  assert.deepEqual(auth, { OPENAI_API_KEY: "fresh-key", last_refresh: "fresh-refresh" });
});

test("provider auth backup replaces duplicate auth_json fields with a single field", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-duplicate-auth-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "model_provider_selected = \"axonhub\"",
      "",
      "[model_providers.axonhub]",
      "name = \"axonhub\"",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = \"\"\"",
      "{\"OPENAI_API_KEY\":\"old-one\"}",
      "\"\"\"",
      "auth_json = '''",
      "{\"OPENAI_API_KEY\":\"old-two\"}",
      "'''",
      "auth_json = '''",
      "{\"OPENAI_API_KEY\":\"old-three\"}",
      "'''",
      "",
      "[model_providers.custom]",
      "name = \"custom\"",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{\"OPENAI_API_KEY\":\"custom-key\"}'''",
      "",
    ].join("\n"),
  );
  writeAuth(codexHome, { OPENAI_API_KEY: "fresh-axonhub-key" });

  selectModelProvider("custom", codexHome);

  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const axonhubSection = config.match(/\[model_providers\.axonhub\][\s\S]*?(?=\n\[|$)/)[0];
  assert.equal((axonhubSection.match(/^auth_json\s*=/gm) || []).length, 1);
  assert.match(axonhubSection, /"OPENAI_API_KEY": "fresh-axonhub-key"/);
  assert.doesNotMatch(axonhubSection, /old-one|old-two|old-three/);
});

test("reports missing Codex config and missing providers", () => {
  const missingHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-missing-"));
  assert.throws(() => loadModelProviders(missingHome), /missing config file:/);

  writeConfig(missingHome, "model = \"gpt-5\"\n");
  assert.throws(() => loadModelProviders(missingHome), /no \[model_providers\.\*\] entries/);
});

test("reports missing or invalid auth_json", () => {
  assert.throws(
    () => authFromProvider({ name: "custom", config: { base_url: "https://api.example.com/v1" } }),
    /provider "custom" has no auth_json/,
  );
  assert.throws(
    () => authFromProvider({ name: "custom", config: { auth_json: "{bad" } }),
    /provider "custom" auth_json is not valid JSON:/,
  );
});

test("reports missing or invalid current auth before switching", () => {
  const missingAuthHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-missing-auth-"));
  writeConfig(
    missingAuthHome,
    [
      "model_provider_selected = \"openai\"",
      "",
      "[model_providers.openai]",
      "auth_json = '''{}'''",
      "",
    ].join("\n"),
  );
  assert.throws(() => selectModelProvider("openai", missingAuthHome), /missing auth file:/);

  writeAuth(missingAuthHome, "{bad");
  fs.writeFileSync(path.join(missingAuthHome, "auth.json"), "{bad");
  assert.throws(() => selectModelProvider("openai", missingAuthHome), /auth\.json is not valid JSON:/);
});

test("reports stale model_provider_selected before switching", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-stale-selected-"));
  writeConfig(
    codexHome,
    [
      "model_provider_selected = \"missing\"",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{}'''",
      "",
    ].join("\n"),
  );
  writeAuth(codexHome, {});

  assert.throws(
    () => selectModelProvider("custom", codexHome),
    /selected model provider "missing" was not found/,
  );
});

test("parses top-level model_provider before other tables", () => {
  assert.equal(
    parseTopLevelModelProvider(
      [
        "model = \"gpt-5\"",
        "model_provider = \"custom\"",
        "",
        "[model_providers.openai]",
        "model_provider = \"ignored\"",
      ].join("\n"),
    ),
    "custom",
  );
});

test("parses top-level model_provider_selected before other tables", () => {
  assert.equal(
    parseTopLevelModelProviderSelected(
      [
        "model_provider_selected = \"custom\"",
        "",
        "[model_providers.openai]",
        "model_provider_selected = \"ignored\"",
      ].join("\n"),
    ),
    "custom",
  );
});

test("stores Codex permission mode in config.toml", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-permission-mode-"));
  writeConfig(
    codexHome,
    [
      "model = \"gpt-5\"",
      "",
      "[model_providers.openai]",
      "permission_mode_selected = \"ignored\"",
      "",
    ].join("\n"),
  );

  assert.equal(parseTopLevelPermissionModeSelected(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8")), "");
  assert.equal(loadCodexPermissionMode(codexHome), "");

  saveCodexPermissionMode("auto", codexHome);
  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");

  assert.match(config, /^permission_mode_selected = "auto"$/m);
  assert.equal(loadCodexPermissionMode(codexHome), "auto");
  assert.match(config, /\[model_providers\.openai\]\npermission_mode_selected = "ignored"/);
});

test("formats unknown provider names with local timestamps", () => {
  assert.equal(unknownProviderName(new Date("2026-05-08T01:02:03")), "unknown-20260508-010203");
});

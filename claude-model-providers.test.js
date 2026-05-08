const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MODEL_FIELDS,
  fetchClaudeModelNames,
  loadClaudeModelChoices,
  loadClaudeModelProviders,
  loadClaudePermissionMode,
  saveClaudeModel,
  saveClaudePermissionMode,
  selectClaudeModelProvider,
} = require("./claude/claude-model-providers");

function writeSettings(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

test("loads Claude model providers from settings.json and marks the selected provider", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-provider-list-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    model_provider_selected: "custom",
    provider: {
      custom: {
        ANTHROPIC_BASE_URL: "https://api.example.com/v1",
      },
      default: {
        ANTHROPIC_BASE_URL: "https://default.example.com/v1",
      },
    },
  });

  const providers = loadClaudeModelProviders(tempDir).providers;

  assert.deepEqual(providers.map((provider) => provider.name), ["custom", "default"]);
  assert.equal(providers[0].selected, true);
  assert.deepEqual(providers[0].columns, ["https://api.example.com/v1"]);
});

test("selecting a Claude provider backs up current env and applies target provider fields", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-provider-select-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    model_provider_selected: "old",
    env: {
      ANTHROPIC_AUTH_TOKEN: "fresh-old-token",
      ANTHROPIC_BASE_URL: "https://old-fresh.example.com/v1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "fresh-haiku",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "fresh-opus",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "fresh-sonnet",
      API_TIMEOUT_MS: "600000",
    },
    provider: {
      old: {
        ANTHROPIC_AUTH_TOKEN: "stale-old-token",
        ANTHROPIC_BASE_URL: "https://old-stale.example.com/v1",
      },
      next: {
        ANTHROPIC_AUTH_TOKEN: "next-token",
        ANTHROPIC_BASE_URL: "https://next.example.com/v1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "next-haiku",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "next-opus",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "next-sonnet",
      },
    },
  });

  const result = selectClaudeModelProvider("next", tempDir);
  const config = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(result.sameProvider, false);
  assert.equal(config.model_provider_selected, "next");
  assert.equal(config.provider.old.ANTHROPIC_AUTH_TOKEN, "fresh-old-token");
  assert.equal(config.provider.old.ANTHROPIC_BASE_URL, "https://old-fresh.example.com/v1");
  assert.equal(config.provider.old.ANTHROPIC_DEFAULT_HAIKU_MODEL, "fresh-haiku");
  assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, "next-token");
  assert.equal(config.env.ANTHROPIC_BASE_URL, "https://next.example.com/v1");
  assert.equal(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "next-sonnet");
  assert.equal(config.env.API_TIMEOUT_MS, "600000");
});

test("selecting a provider without old selection directly applies target provider", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-provider-no-selected-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    env: {
      API_TIMEOUT_MS: "600000",
      ANTHROPIC_AUTH_TOKEN: "old-env-token",
    },
    provider: {
      next: {
        ANTHROPIC_BASE_URL: "https://next.example.com/v1",
      },
    },
  });

  selectClaudeModelProvider("next", tempDir);
  const config = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(config.model_provider_selected, "next");
  assert.equal(config.env.ANTHROPIC_BASE_URL, "https://next.example.com/v1");
  assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(config.env.API_TIMEOUT_MS, "600000");
});

test("stores Claude permission mode in settings.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-permission-mode-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    language: "zh-CN",
  });

  assert.equal(loadClaudePermissionMode(tempDir), "");
  saveClaudePermissionMode("full", tempDir);

  const config = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(config.permission_mode_selected, "full");
  assert.equal(config.language, "zh-CN");
  assert.equal(loadClaudePermissionMode(tempDir), "full");
});

test("fetches Claude model names from the selected provider /v1/models endpoint", async () => {
  const calls = [];
  const names = await fetchClaudeModelNames(
    {
      ANTHROPIC_BASE_URL: "https://api.example.com/",
      ANTHROPIC_AUTH_TOKEN: "test-token",
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "zeta" }, { id: "alpha" }, { id: "alpha" }],
          }),
        };
      },
    },
  );

  assert.deepEqual(names, ["alpha", "zeta"]);
  assert.equal(calls[0].url, "https://api.example.com/v1/models");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
});

test("does not append duplicate v1 when Claude base URL already ends with v1", async () => {
  const calls = [];
  await fetchClaudeModelNames(
    {
      ANTHROPIC_BASE_URL: "https://api.example.com/v1/",
      ANTHROPIC_AUTH_TOKEN: "test-token",
    },
    {
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({ data: [] }) };
      },
    },
  );

  assert.deepEqual(calls, ["https://api.example.com/v1/models"]);
});

test("reports Claude model fetch failures", async () => {
  await assert.rejects(
    () => fetchClaudeModelNames(
      { ANTHROPIC_BASE_URL: "https://api.example.com/v1", ANTHROPIC_AUTH_TOKEN: "test-token" },
      { fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized" }) },
    ),
    /HTTP 401 Unauthorized/,
  );

  await assert.rejects(
    () => fetchClaudeModelNames(
      { ANTHROPIC_BASE_URL: "https://api.example.com/v1", ANTHROPIC_AUTH_TOKEN: "test-token" },
      { fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ object: "model" }] }) }) },
    ),
    /invalid models response/,
  );
});

test("loads Claude model choices from the selected provider and marks the current value", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-model-choices-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    model_provider_selected: "custom",
    env: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: "env-sonnet",
    },
    provider: {
      custom: {
        ANTHROPIC_AUTH_TOKEN: "test-token",
        ANTHROPIC_BASE_URL: "https://api.example.com/v1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "configured-sonnet",
      },
    },
  });

  const choices = await loadClaudeModelChoices(MODEL_FIELDS.sonnet, {
    claudeHome: tempDir,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "remote-sonnet" }, { id: "configured-sonnet" }] }),
    }),
  });

  assert.deepEqual(choices, [
    { name: "configured-sonnet", label: "configured-sonnet", selected: false, columns: [""] },
    { name: "env-sonnet", label: "env-sonnet", selected: true, columns: ["selected"] },
    { name: "remote-sonnet", label: "remote-sonnet", selected: false, columns: [""] },
  ]);
});

test("saving a Claude model updates env and the selected provider", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-save-model-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    model_provider_selected: "custom",
    env: {
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "old-haiku",
    },
    provider: {
      custom: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "old-provider-haiku",
      },
    },
  });

  const result = saveClaudeModel(MODEL_FIELDS.haiku, "new-haiku", { claudeHome: tempDir });
  const config = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.deepEqual(result, {
    providerName: "custom",
    fieldName: MODEL_FIELDS.haiku,
    value: "new-haiku",
  });
  assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "new-haiku");
  assert.equal(config.provider.custom.ANTHROPIC_DEFAULT_HAIKU_MODEL, "new-haiku");
});

test("saving a Claude model requires a valid selected provider", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-save-model-missing-"));
  const settingsPath = path.join(tempDir, "settings.json");
  writeSettings(settingsPath, {
    provider: {
      custom: {},
    },
  });

  assert.throws(
    () => saveClaudeModel(MODEL_FIELDS.haiku, "new-haiku", { claudeHome: tempDir }),
    /no model_provider_selected/,
  );
});

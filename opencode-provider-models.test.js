const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  fetchRemoteModelNames,
  loadConfiguredModelChoices,
  loadConfiguredModelValue,
  loadAiSdkProviders,
  loadOpenCodePermissionMode,
  loadProviderModels,
  parseJsonc,
  saveConfiguredModel,
  saveOpenCodePermissionMode,
  saveProviderModels,
} = require("./opencode/opencode-provider-models");

function writeConfig(file, configText) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, configText);
}

test("parses OpenCode JSONC with comments and trailing commas", () => {
  assert.deepEqual(
    parseJsonc([
      "{",
      "  // comment",
      "  \"provider\": {",
      "    \"demo\": { \"npm\": \"@ai-sdk/openai\", },",
      "  },",
      "}",
    ].join("\n")),
    { provider: { demo: { npm: "@ai-sdk/openai" } } },
  );
});

test("loads @ai-sdk providers with baseURL and apiKey only", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-list-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      provider: {
        valid: {
          npm: "@ai-sdk/openai",
          options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" },
          models: { alpha: {}, zeta: {} },
        },
        missingKey: {
          npm: "@ai-sdk/openai",
          options: { baseURL: "https://api.example.com/v1" },
        },
        local: {
          options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" },
        },
      },
    }),
  );

  const providers = loadAiSdkProviders(configPath);
  assert.deepEqual(providers.map((provider) => provider.name), ["valid"]);
  assert.deepEqual(providers[0].columns, ["2 models", "@ai-sdk/openai"]);
});

test("fetches remote model names from OpenAI-compatible /models", async () => {
  const calls = [];
  const names = await fetchRemoteModelNames(
    {
      options: {
        baseURL: "https://api.example.com/v1/",
        apiKey: "test-key",
      },
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
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
});

test("reports model fetch failures", async () => {
  await assert.rejects(
    () => fetchRemoteModelNames(
      { options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" } },
      {
        fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized" }),
      },
    ),
    /HTTP 401 Unauthorized/,
  );

  await assert.rejects(
    () => fetchRemoteModelNames(
      { options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" } },
      {
        fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ object: "model" }] }) }),
      },
    ),
    /invalid models response/,
  );
});

test("accepts an empty remote model list", async () => {
  const names = await fetchRemoteModelNames(
    { options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" } },
    {
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }),
    },
  );

  assert.deepEqual(names, []);
});

test("loads configured-only and remote models with configured selections", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-models-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      provider: {
        demo: {
          npm: "@ai-sdk/openai",
          options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" },
          models: {
            "configured-only": {},
            remote: {},
          },
        },
      },
    }),
  );

  const models = await loadProviderModels("demo", {
    configPath,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "remote" }, { id: "new-remote" }] }),
    }),
  });

  assert.deepEqual(models, [
    { name: "configured-only", label: "configured-only", selected: true, description: "configured" },
    { name: "new-remote", label: "new-remote", selected: false, description: "" },
    { name: "remote", label: "remote", selected: true, description: "" },
  ]);
});

test("uses another same-origin provider as model-list fallback when primary is empty", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-models-fallback-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      provider: {
        chat: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" },
          models: {
            "configured-chat": {},
          },
        },
        anthropic: {
          npm: "@ai-sdk/anthropic",
          options: { baseURL: "https://api.example.com/anthropic/v1", apiKey: "test-key" },
          models: {},
        },
      },
    }),
  );

  const models = await loadProviderModels("chat", {
    configPath,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => url.includes("/anthropic/")
        ? { data: [{ id: "fallback-remote" }] }
        : { data: [] },
    }),
  });

  assert.deepEqual(models, [
    { name: "configured-chat", label: "configured-chat", selected: true, description: "configured" },
    { name: "fallback-remote", label: "fallback-remote", selected: false, description: "" },
  ]);
});

test("saves selected models as an object and normalizes config JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-save-models-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    [
      "{",
      "  \"provider\": {",
      "    \"demo\": {",
      "      \"npm\": \"@ai-sdk/openai\",",
      "      \"options\": { \"baseURL\": \"https://api.example.com/v1\", \"apiKey\": \"test-key\" },",
      "      \"models\": { \"old\": {} },",
      "    },",
      "  },",
      "}",
    ].join("\n"),
  );

  const result = saveProviderModels("demo", ["zeta", "alpha", "alpha"], { configPath });
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(result.selectedCount, 2);
  assert.deepEqual(config.provider.demo.models, { alpha: {}, zeta: {} });
  assert.doesNotMatch(fs.readFileSync(configPath, "utf8"), /,\s*}/);
});

test("saving no models keeps an empty models object", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-save-empty-models-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      provider: {
        demo: {
          npm: "@ai-sdk/openai",
          options: { baseURL: "https://api.example.com/v1", apiKey: "test-key" },
          models: { old: {} },
        },
      },
    }),
  );

  saveProviderModels("demo", [], { configPath });

  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")).provider.demo.models, {});
});

test("loads configured model choices and marks the selected field value", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-default-model-choices-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      model: "provider-b/beta",
      small_model: "provider-a/alpha",
      provider: {
        "provider-b": { models: { beta: {} } },
        "provider-a": { models: { alpha: {}, gamma: {} } },
      },
    }),
  );

  assert.deepEqual(loadConfiguredModelChoices("model", configPath), [
    { name: "provider-a/alpha", label: "provider-a/alpha", selected: false, columns: [""] },
    { name: "provider-a/gamma", label: "provider-a/gamma", selected: false, columns: [""] },
    { name: "provider-b/beta", label: "provider-b/beta", selected: true, columns: ["selected"] },
  ]);
});

test("loads configured OpenCode model field values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-model-values-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      model: "provider-a/alpha",
      small_model: "provider-b/beta",
    }),
  );

  assert.equal(loadConfiguredModelValue("model", configPath), "provider-a/alpha");
  assert.equal(loadConfiguredModelValue("small_model", configPath), "provider-b/beta");
});

test("stores OpenCode permission mode in opencode.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-permission-mode-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      model: "provider-a/alpha",
    }),
  );

  assert.equal(loadOpenCodePermissionMode(configPath), "");
  saveOpenCodePermissionMode("full", configPath);

  let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.permission, "allow");
  assert.equal(config.permission_mode_selected, undefined);
  assert.equal(config.model, "provider-a/alpha");
  assert.equal(loadOpenCodePermissionMode(configPath), "full");

  saveOpenCodePermissionMode("default", configPath);

  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.permission, "ask");
  assert.equal(config.permission_mode_selected, undefined);
  assert.equal(loadOpenCodePermissionMode(configPath), "");
});

test("migrates legacy OpenCode picker permission mode to native permission", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-legacy-permission-mode-"));
  const fullConfigPath = path.join(tempDir, "opencode-full.json");
  const defaultConfigPath = path.join(tempDir, "opencode-default.json");
  writeConfig(
    fullConfigPath,
    JSON.stringify({
      model: "provider-a/alpha",
      permission_mode_selected: "full",
    }),
  );
  writeConfig(
    defaultConfigPath,
    JSON.stringify({
      model: "provider-a/alpha",
      permission_mode_selected: "default",
    }),
  );

  assert.equal(loadOpenCodePermissionMode(fullConfigPath), "full");

  const fullConfig = JSON.parse(fs.readFileSync(fullConfigPath, "utf8"));
  assert.equal(fullConfig.permission_mode_selected, undefined);
  assert.equal(fullConfig.permission, "allow");
  assert.equal(fullConfig.model, "provider-a/alpha");

  assert.equal(loadOpenCodePermissionMode(defaultConfigPath), "");

  const defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
  assert.equal(defaultConfig.permission_mode_selected, undefined);
  assert.equal(defaultConfig.permission, "ask");
  assert.equal(defaultConfig.model, "provider-a/alpha");
});

test("saves OpenCode default and small model fields", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-save-default-models-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      model: "provider-a/alpha",
      small_model: "provider-a/alpha",
      provider: {
        "provider-a": { models: { alpha: {}, beta: {} } },
      },
    }),
  );

  assert.deepEqual(saveConfiguredModel("model", "provider-a/beta", { configPath }), {
    fieldName: "model",
    value: "provider-a/beta",
  });
  assert.deepEqual(saveConfiguredModel("small_model", "provider-a/beta", { configPath }), {
    fieldName: "small_model",
    value: "provider-a/beta",
  });

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.model, "provider-a/beta");
  assert.equal(config.small_model, "provider-a/beta");
});

test("rejects unknown configured model values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-save-unknown-default-model-"));
  const configPath = path.join(tempDir, "opencode.json");
  writeConfig(
    configPath,
    JSON.stringify({
      provider: {
        "provider-a": { models: { alpha: {} } },
      },
    }),
  );

  assert.throws(
    () => saveConfiguredModel("model", "provider-a/missing", { configPath }),
    /unknown configured model: provider-a\/missing/,
  );
});

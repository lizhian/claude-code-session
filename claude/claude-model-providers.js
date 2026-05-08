const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROVIDER_ENV_FIELDS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
];

const MODEL_FIELDS = {
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
};

function defaultClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

function claudeSettingsPath(claudeHome = defaultClaudeHome()) {
  return path.join(claudeHome, "settings.json");
}

function readClaudeSettings(configPath = claudeSettingsPath()) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`missing Claude settings file: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Claude settings must be a JSON object");
  }
  return config;
}

function readOptionalClaudeSettings(configPath = claudeSettingsPath()) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return readClaudeSettings(configPath);
}

function writeClaudeSettings(config, configPath = claudeSettingsPath()) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, configPath);
  fs.chmodSync(configPath, 0o600);
}

function providerMap(config) {
  return config && config.provider && typeof config.provider === "object" && !Array.isArray(config.provider)
    ? config.provider
    : {};
}

function selectedProviderName(config) {
  return typeof config.model_provider_selected === "string" ? config.model_provider_selected : "";
}

function permissionModeSelected(config) {
  return typeof config.permission_mode_selected === "string" ? config.permission_mode_selected : "";
}

function activeModelValue(config, fieldName) {
  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env) ? config.env : {};
  if (typeof env[fieldName] === "string") {
    return env[fieldName];
  }

  const selected = selectedProviderName(config);
  const provider = selected ? providerMap(config)[selected] : null;
  return provider && typeof provider[fieldName] === "string" ? provider[fieldName] : "";
}

function providerEntries(config) {
  const selected = selectedProviderName(config);
  return Object.entries(providerMap(config))
    .filter(([, provider]) => provider && typeof provider === "object" && !Array.isArray(provider))
    .map(([name, provider]) => ({
      name,
      label: name,
      selected: selected ? name === selected : false,
      columns: [
        provider.ANTHROPIC_BASE_URL || "",
      ],
      provider,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadClaudeModelProviders(claudeHomeOrConfigPath = defaultClaudeHome(), options = {}) {
  const configPath = options.configPath || claudeSettingsPath(claudeHomeOrConfigPath);
  const config = readClaudeSettings(configPath);
  const providers = providerEntries(config);
  if (providers.length === 0) {
    throw new Error("no provider entries found in settings.json");
  }
  return {
    config,
    configPath,
    providers,
    selectedProviderName: selectedProviderName(config),
  };
}

function backupEnvToProvider(config, providerName) {
  if (!providerName) {
    return false;
  }

  const providers = providerMap(config);
  const provider = providers[providerName];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error(`selected model provider ${JSON.stringify(providerName)} was not found`);
  }

  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env) ? config.env : {};
  for (const field of PROVIDER_ENV_FIELDS) {
    if (Object.hasOwn(env, field)) {
      provider[field] = env[field];
    } else {
      delete provider[field];
    }
  }
  return true;
}

function applyProviderToEnv(config, provider) {
  if (!config.env || typeof config.env !== "object" || Array.isArray(config.env)) {
    config.env = {};
  }

  for (const field of PROVIDER_ENV_FIELDS) {
    if (Object.hasOwn(provider, field)) {
      config.env[field] = provider[field];
    } else {
      delete config.env[field];
    }
  }
}

function selectClaudeModelProvider(providerName, claudeHomeOrConfigPath = defaultClaudeHome(), options = {}) {
  const configPath = options.configPath || claudeSettingsPath(claudeHomeOrConfigPath);
  const config = readClaudeSettings(configPath);
  const providers = providerMap(config);
  const provider = providers[providerName];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error(`unknown model provider: ${providerName}`);
  }

  const previousProviderName = selectedProviderName(config);
  const sameProvider = previousProviderName === providerName;
  if (sameProvider) {
    backupEnvToProvider(config, providerName);
  } else if (previousProviderName) {
    backupEnvToProvider(config, previousProviderName);
  }

  applyProviderToEnv(config, provider);
  config.model_provider_selected = providerName;
  writeClaudeSettings(config, configPath);

  return {
    provider: { name: providerName, config: provider },
    configPath,
    previousProviderName,
    sameProvider,
  };
}

function selectedProvider(config) {
  const name = selectedProviderName(config);
  if (!name) {
    throw new Error("no model_provider_selected in Claude settings");
  }

  const provider = providerMap(config)[name];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error(`selected model provider ${JSON.stringify(name)} was not found`);
  }
  return { name, provider };
}

async function fetchClaudeModelNames(provider, options = {}) {
  const baseURL = provider && provider.ANTHROPIC_BASE_URL;
  const token = provider && provider.ANTHROPIC_AUTH_TOKEN;
  if (typeof baseURL !== "string" || !baseURL) {
    throw new Error("provider ANTHROPIC_BASE_URL is required");
  }
  if (typeof token !== "string" || !token) {
    throw new Error("provider ANTHROPIC_AUTH_TOKEN is required");
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const timeoutMs = options.timeoutMs || 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const normalizedBaseURL = baseURL.replace(/\/+$/, "");
  const url = normalizedBaseURL.endsWith("/v1")
    ? `${normalizedBaseURL}/models`
    : `${normalizedBaseURL}/v1/models`;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : "";
      const statusText = response && response.statusText ? response.statusText : "";
      throw new Error(`HTTP ${`${status} ${statusText}`.trim()}`);
    }

    const body = await response.json();
    if (!body || !Array.isArray(body.data)) {
      throw new Error("invalid models response");
    }

    const names = body.data
      .map((model) => model && model.id)
      .filter((id) => typeof id === "string" && id.length > 0);
    if (body.data.length > 0 && names.length === 0) {
      throw new Error("invalid models response");
    }

    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateModelField(fieldName) {
  if (!PROVIDER_ENV_FIELDS.includes(fieldName) || !fieldName.startsWith("ANTHROPIC_DEFAULT_")) {
    throw new Error(`unsupported Claude model field: ${fieldName}`);
  }
}

async function loadClaudeModelChoices(fieldName, options = {}) {
  validateModelField(fieldName);
  const configPath = options.configPath || claudeSettingsPath(options.claudeHome || defaultClaudeHome());
  const config = readClaudeSettings(configPath);
  const { provider } = selectedProvider(config);
  const remoteNames = await fetchClaudeModelNames(provider, options);
  const currentValue = activeModelValue(config, fieldName);
  const names = [...new Set([currentValue, ...remoteNames].filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return names.map((name) => ({
    name,
    label: name,
    selected: name === currentValue,
    columns: [name === currentValue ? "selected" : ""],
  }));
}

function saveClaudeModel(fieldName, modelName, options = {}) {
  validateModelField(fieldName);
  if (typeof modelName !== "string" || !modelName) {
    throw new Error("model name is required");
  }

  const configPath = options.configPath || claudeSettingsPath(options.claudeHome || defaultClaudeHome());
  const config = readClaudeSettings(configPath);
  const { name: providerName, provider } = selectedProvider(config);

  if (!config.env || typeof config.env !== "object" || Array.isArray(config.env)) {
    config.env = {};
  }
  config.env[fieldName] = modelName;
  provider[fieldName] = modelName;
  writeClaudeSettings(config, configPath);

  return {
    providerName,
    fieldName,
    value: modelName,
  };
}

function loadClaudePermissionMode(claudeHome = defaultClaudeHome()) {
  return permissionModeSelected(readOptionalClaudeSettings(claudeSettingsPath(claudeHome)));
}

function saveClaudePermissionMode(permissionMode, claudeHome = defaultClaudeHome()) {
  const configPath = claudeSettingsPath(claudeHome);
  const config = readOptionalClaudeSettings(configPath);
  config.permission_mode_selected = permissionMode;
  writeClaudeSettings(config, configPath);
}

module.exports = {
  MODEL_FIELDS,
  PROVIDER_ENV_FIELDS,
  activeModelValue,
  backupEnvToProvider,
  claudeSettingsPath,
  defaultClaudeHome,
  fetchClaudeModelNames,
  loadClaudeModelChoices,
  loadClaudeModelProviders,
  loadClaudePermissionMode,
  readClaudeSettings,
  saveClaudeModel,
  saveClaudePermissionMode,
  selectClaudeModelProvider,
  writeClaudeSettings,
};

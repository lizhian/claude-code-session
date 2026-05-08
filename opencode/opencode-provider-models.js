const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultOpenCodeConfigPath() {
  return path.join(os.homedir(), ".config", "opencode", "opencode.json");
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      } else if (char === "\n" || char === "\r") {
        output += char;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(text) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === ",") {
      let cursor = index + 1;
      while (/\s/.test(text[cursor] || "")) {
        cursor += 1;
      }
      if (text[cursor] === "}" || text[cursor] === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(String(text || ""))));
}

function readOpenCodeConfig(configPath = defaultOpenCodeConfigPath()) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`missing OpenCode config file: ${configPath}`);
  }

  const text = fs.readFileSync(configPath, "utf8");
  const config = parseJsonc(text);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("OpenCode config must be a JSON object");
  }
  return config;
}

function writeOpenCodeConfig(config, configPath = defaultOpenCodeConfigPath()) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, configPath);
  fs.chmodSync(configPath, 0o600);
}

function aiSdkProviderEntries(config) {
  const providers = config && config.provider && typeof config.provider === "object" ? config.provider : {};

  return Object.entries(providers)
    .filter(([, provider]) => {
      const options = provider && provider.options && typeof provider.options === "object" ? provider.options : {};
      return provider &&
        typeof provider.npm === "string" &&
        provider.npm.startsWith("@ai-sdk/") &&
        typeof options.baseURL === "string" &&
        options.baseURL &&
        typeof options.apiKey === "string" &&
        options.apiKey;
    })
    .map(([name, provider]) => ({
      name,
      label: name,
      columns: [`${configuredModelNames(provider).length} models`, provider.npm],
      provider,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadAiSdkProviders(configPath = defaultOpenCodeConfigPath()) {
  const config = readOpenCodeConfig(configPath);
  return aiSdkProviderEntries(config);
}

function configuredModelNames(provider) {
  const models = provider && provider.models && typeof provider.models === "object" ? provider.models : {};
  return Object.keys(models).sort((a, b) => a.localeCompare(b));
}

function configuredModelChoices(config, fieldName) {
  const providers = config && config.provider && typeof config.provider === "object" ? config.provider : {};
  const selectedValue = typeof config[fieldName] === "string" ? config[fieldName] : "";
  const choices = [];

  for (const [providerName, provider] of Object.entries(providers)) {
    for (const modelName of configuredModelNames(provider)) {
      const value = `${providerName}/${modelName}`;
      choices.push({
        name: value,
        label: value,
        selected: value === selectedValue,
        columns: value === selectedValue ? ["selected"] : [""],
      });
    }
  }

  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

function loadConfiguredModelChoices(fieldName, configPath = defaultOpenCodeConfigPath()) {
  return configuredModelChoices(readOpenCodeConfig(configPath), fieldName);
}

async function fetchRemoteModelNames(provider, options = {}) {
  const providerOptions = provider && provider.options && typeof provider.options === "object" ? provider.options : {};
  const baseURL = providerOptions.baseURL;
  const apiKey = providerOptions.apiKey;

  if (typeof baseURL !== "string" || !baseURL) {
    throw new Error("provider options.baseURL is required");
  }
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("provider options.apiKey is required");
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const timeoutMs = options.timeoutMs || 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseURL.replace(/\/+$/, "")}/models`;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

function sameModelSource(left, right) {
  const leftOptions = left && left.options && typeof left.options === "object" ? left.options : {};
  const rightOptions = right && right.options && typeof right.options === "object" ? right.options : {};
  if (leftOptions.apiKey !== rightOptions.apiKey) {
    return false;
  }

  try {
    return new URL(leftOptions.baseURL).origin === new URL(rightOptions.baseURL).origin;
  } catch {
    return false;
  }
}

async function fetchRemoteModelNamesWithFallback(providerName, config, provider, options = {}) {
  const primary = await fetchRemoteModelNames(provider, options);
  if (primary.length > 0) {
    return primary;
  }

  const candidates = aiSdkProviderEntries(config)
    .filter((item) => item.name !== providerName && sameModelSource(provider, item.provider));

  for (const candidate of candidates) {
    try {
      const fallback = await fetchRemoteModelNames(candidate.provider, options);
      if (fallback.length > 0) {
        return fallback;
      }
    } catch {
      // Keep trying other configured providers that share the same model source.
    }
  }

  return primary;
}

async function loadProviderModels(providerName, options = {}) {
  const configPath = options.configPath || defaultOpenCodeConfigPath();
  const config = readOpenCodeConfig(configPath);
  const provider = config.provider && config.provider[providerName];
  if (!provider) {
    throw new Error(`unknown OpenCode provider: ${providerName}`);
  }

  const configured = configuredModelNames(provider);
  const remote = await fetchRemoteModelNamesWithFallback(providerName, config, provider, options);
  const remoteSet = new Set(remote);
  const configuredOnly = configured.filter((name) => !remoteSet.has(name));
  const names = [...configuredOnly, ...remote];
  const configuredSet = new Set(configured);

  return names.map((name) => ({
    name,
    label: name,
    selected: configuredSet.has(name),
    description: remoteSet.has(name) ? "" : "configured",
  }));
}

function saveProviderModels(providerName, selectedModelNames, options = {}) {
  const configPath = options.configPath || defaultOpenCodeConfigPath();
  const config = readOpenCodeConfig(configPath);
  const provider = config.provider && config.provider[providerName];
  if (!provider) {
    throw new Error(`unknown OpenCode provider: ${providerName}`);
  }

  provider.models = {};
  for (const name of [...new Set(selectedModelNames)].sort((a, b) => a.localeCompare(b))) {
    provider.models[name] = {};
  }
  writeOpenCodeConfig(config, configPath);

  return { providerName, selectedCount: Object.keys(provider.models).length };
}

function saveConfiguredModel(fieldName, value, options = {}) {
  if (fieldName !== "model" && fieldName !== "small_model") {
    throw new Error(`unsupported OpenCode model field: ${fieldName}`);
  }

  const configPath = options.configPath || defaultOpenCodeConfigPath();
  const config = readOpenCodeConfig(configPath);
  const choices = new Set(configuredModelChoices(config, fieldName).map((choice) => choice.name));
  if (!choices.has(value)) {
    throw new Error(`unknown configured model: ${value}`);
  }

  config[fieldName] = value;
  writeOpenCodeConfig(config, configPath);
  return { fieldName, value };
}

module.exports = {
  aiSdkProviderEntries,
  configuredModelChoices,
  configuredModelNames,
  defaultOpenCodeConfigPath,
  fetchRemoteModelNames,
  fetchRemoteModelNamesWithFallback,
  loadAiSdkProviders,
  loadConfiguredModelChoices,
  loadProviderModels,
  parseJsonc,
  readOpenCodeConfig,
  saveConfiguredModel,
  saveProviderModels,
  stripJsonComments,
  stripTrailingCommas,
  writeOpenCodeConfig,
};

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function codexConfigPath(codexHome = defaultCodexHome()) {
  return path.join(codexHome, "config.toml");
}

function codexAuthPath(codexHome = defaultCodexHome()) {
  return path.join(codexHome, "auth.json");
}

function parseTomlString(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTableName(line) {
  const match = line.match(/^\s*\[(.+)]\s*$/);
  if (!match) {
    return null;
  }

  const raw = match[1].trim();
  if (!raw.startsWith("model_providers.")) {
    return null;
  }

  const providerName = raw.slice("model_providers.".length).trim();
  if (!providerName) {
    return null;
  }
  if (
    (providerName.startsWith('"') && providerName.endsWith('"')) ||
    (providerName.startsWith("'") && providerName.endsWith("'"))
  ) {
    return parseTomlString(providerName);
  }
  return providerName;
}

function parseMultilineString(lines, startIndex, initialValue) {
  const trimmed = initialValue.trimStart();
  const delimiter = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null;
  if (!delimiter) {
    return null;
  }

  let remainder = trimmed.slice(3);
  const parts = [];
  if (remainder.length > 0) {
    const endAt = remainder.indexOf(delimiter);
    if (endAt !== -1) {
      return { value: remainder.slice(0, endAt), nextIndex: startIndex };
    }
    parts.push(remainder);
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const endAt = line.indexOf(delimiter);
    if (endAt !== -1) {
      parts.push(line.slice(0, endAt));
      return { value: parts.join("\n"), nextIndex: index };
    }
    parts.push(line);
  }

  throw new Error(`unterminated multiline string near line ${startIndex + 1}`);
}

function parseTopLevelModelProvider(text) {
  return parseTopLevelStringField(text, "model_provider");
}

function parseTopLevelModelProviderSelected(text) {
  return parseTopLevelStringField(text, "model_provider_selected");
}

function parseTopLevelStringField(text, fieldName) {
  const lines = String(text || "").split(/\r?\n/);
  const topLevelEnd = lines.findIndex((line) => /^\s*\[/.test(line));
  const searchEnd = topLevelEnd === -1 ? lines.length : topLevelEnd;
  const pattern = new RegExp(`^\\s*${fieldName}\\s*=\\s*(.*?)\\s*(?:#.*)?$`);

  for (const line of lines.slice(0, searchEnd)) {
    const match = line.match(pattern);
    if (match) {
      return parseTomlString(match[1]);
    }
  }

  return "";
}

function parseTomlProviders(text) {
  const lines = String(text || "").split(/\r?\n/);
  const providers = [];
  const byName = new Map();
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const tableName = parseTableName(line);
    if (tableName !== null) {
      current = { name: tableName, config: {} };
      providers.push(current);
      byName.set(tableName, current.config);
      continue;
    }

    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const keyValue = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!keyValue) {
      continue;
    }

    const key = keyValue[1];
    const rawValue = keyValue[2];
    const multiline = parseMultilineString(lines, index, rawValue);
    if (multiline) {
      current.config[key] = multiline.value;
      index = multiline.nextIndex;
      continue;
    }

    const value = rawValue.trim();
    if (value === "true" || value === "false") {
      current.config[key] = value === "true";
    } else {
      current.config[key] = parseTomlString(value);
    }
  }

  return {
    providers,
    byName,
    modelProviderName: parseTopLevelModelProvider(text),
    selectedProviderName: parseTopLevelModelProviderSelected(text) || parseTopLevelModelProvider(text),
  };
}

function withSelectedProvider(providers, selectedProviderName) {
  return providers.map((provider) => ({
    ...provider,
    selected: selectedProviderName ? provider.name === selectedProviderName : false,
  }));
}

function loadModelProviders(codexHome = defaultCodexHome()) {
  const configPath = codexConfigPath(codexHome);
  if (!fs.existsSync(configPath)) {
    throw new Error(`missing config file: ${configPath}`);
  }

  const text = fs.readFileSync(configPath, "utf8");
  const parsed = parseTomlProviders(text);
  if (parsed.providers.length === 0) {
    throw new Error("no [model_providers.*] entries found in config.toml");
  }

  return {
    text,
    providers: withSelectedProvider(parsed.providers, parsed.selectedProviderName),
    byName: parsed.byName,
    modelProviderName: parsed.modelProviderName,
    selectedProviderName: parsed.selectedProviderName,
  };
}

function readAuth(authPath) {
  if (!fs.existsSync(authPath)) {
    throw new Error(`missing auth file: ${authPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch (error) {
    throw new Error(`auth.json is not valid JSON: ${error.message}`);
  }
}

function authFromProvider(provider) {
  if (!Object.hasOwn(provider.config, "auth_json")) {
    throw new Error(`provider ${JSON.stringify(provider.name)} has no auth_json`);
  }
  if (typeof provider.config.auth_json !== "string") {
    throw new Error(`provider ${JSON.stringify(provider.name)} auth_json must be a JSON string`);
  }

  try {
    return JSON.parse(provider.config.auth_json);
  } catch (error) {
    throw new Error(`provider ${JSON.stringify(provider.name)} auth_json is not valid JSON: ${error.message}`);
  }
}

function writeAuth(auth, authPath) {
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const tmpPath = `${authPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, authPath);
  fs.chmodSync(authPath, 0o600);
}

function writeConfigText(configPath, text) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, text, { mode: 0o600 });
  fs.renameSync(tmpPath, configPath);
  fs.chmodSync(configPath, 0o600);
}

function setTopLevelStringField(text, fieldName, value) {
  const lines = text.split(/(?<=\n)/);
  const topLevelEnd = lines.findIndex((line) => /^\s*\[/.test(line));
  const searchEnd = topLevelEnd === -1 ? lines.length : topLevelEnd;
  const pattern = new RegExp(`^\\s*${fieldName}\\s*=`);
  const existing = lines.slice(0, searchEnd).findIndex((line) => pattern.test(line));
  const replacement = `${fieldName} = ${JSON.stringify(value)}\n`;

  if (existing !== -1) {
    lines[existing] = replacement;
    return lines.join("");
  }

  const modelProviderIndex = lines.slice(0, searchEnd).findIndex((line) => /^\s*model_provider\s*=/.test(line));
  if (modelProviderIndex !== -1) {
    lines.splice(modelProviderIndex + 1, 0, replacement);
    return lines.join("");
  }

  const modelIndex = lines.slice(0, searchEnd).findIndex((line) => /^\s*model\s*=/.test(line));
  lines.splice(modelIndex === -1 ? 0 : modelIndex + 1, 0, replacement);
  return lines.join("");
}

function removeTopLevelField(text, fieldName) {
  const lines = text.split(/(?<=\n)/);
  const topLevelEnd = lines.findIndex((line) => /^\s*\[/.test(line));
  const searchEnd = topLevelEnd === -1 ? lines.length : topLevelEnd;
  const pattern = new RegExp(`^\\s*${fieldName}\\s*=`);
  const existing = lines.slice(0, searchEnd).findIndex((line) => pattern.test(line));
  if (existing !== -1) {
    lines.splice(existing, 1);
  }
  return lines.join("");
}

function updateModelProviderText(text, providerName, providerConfig) {
  if (Object.hasOwn(providerConfig, "base_url")) {
    return setTopLevelStringField(text, "model_provider", providerName);
  }
  return removeTopLevelField(text, "model_provider");
}

function tableHeaderForProvider(providerName) {
  return `[model_providers.${JSON.stringify(providerName)}]`;
}

function findProviderTableRange(text, providerName) {
  const lines = text.split(/(?<=\n)/);
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (parseTableName(lines[index]) === providerName) {
      start = index;
      break;
    }
  }

  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return { lines, start, end };
}

function formatAuthJsonValue(auth) {
  return `'''\n${JSON.stringify(auth, null, 2)}\n'''`;
}

function setProviderAuthJsonText(text, providerName, auth) {
  const range = findProviderTableRange(text, providerName);
  if (!range) {
    throw new Error(`selected model provider ${JSON.stringify(providerName)} was not found`);
  }

  const { lines, start } = range;
  let end = range.end;
  const replacement = `auth_json = ${formatAuthJsonValue(auth)}\n`;
  let insertIndex = null;

  for (let index = start + 1; index < end;) {
    const line = lines[index].replace(/\r?\n$/, "");
    const keyValue = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!keyValue || keyValue[1] !== "auth_json") {
      index += 1;
      continue;
    }

    if (insertIndex === null) {
      insertIndex = index;
    }

    const multiline = parseMultilineString(lines.map((line) => line.replace(/\n$/, "")), index, keyValue[2]);
    const removeCount = multiline ? multiline.nextIndex - index + 1 : 1;
    lines.splice(index, removeCount);
    end -= removeCount;
  }

  if (insertIndex !== null) {
    lines.splice(insertIndex, 0, replacement);
  } else {
    lines.splice(end, 0, replacement);
  }

  return lines.join("");
}

function timestampForUnknownProvider(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function unknownProviderName(now = new Date()) {
  return `unknown-${timestampForUnknownProvider(now)}`;
}

function appendUnknownProviderText(text, providerName, auth) {
  let output = text;
  if (output.length > 0 && !output.endsWith("\n")) {
    output += "\n";
  }
  if (output.length > 0) {
    output += "\n";
  }
  output += [
    tableHeaderForProvider(providerName),
    `name = ${JSON.stringify(providerName)}`,
    `auth_json = ${formatAuthJsonValue(auth)}`,
    "",
  ].join("\n");
  return output;
}

function updateModelProvider(providerName, providerConfig, configPath) {
  const text = fs.readFileSync(configPath, "utf8");
  const updatedText = updateModelProviderText(text, providerName, providerConfig);
  if (updatedText === text) {
    return false;
  }
  writeConfigText(configPath, updatedText);
  return true;
}

function selectModelProvider(providerName, codexHome = defaultCodexHome(), options = {}) {
  const configPath = codexConfigPath(codexHome);
  const authPath = codexAuthPath(codexHome);
  const currentAuth = readAuth(authPath);
  const { providers, selectedProviderName } = loadModelProviders(codexHome);
  const provider = providers.find((item) => item.name === providerName);
  if (!provider) {
    throw new Error(`unknown model provider: ${providerName}`);
  }
  const sameProvider = selectedProviderName === providerName;
  const targetAuth = sameProvider ? currentAuth : authFromProvider(provider);
  const previousProviderName = selectedProviderName || unknownProviderName(options.now);
  const previousProvider = providers.find((item) => item.name === previousProviderName);

  if (selectedProviderName && !previousProvider) {
    throw new Error(`selected model provider ${JSON.stringify(selectedProviderName)} was not found`);
  }

  let configText = fs.readFileSync(configPath, "utf8");
  if (previousProvider) {
    configText = setProviderAuthJsonText(configText, previousProvider.name, currentAuth);
  } else {
    configText = appendUnknownProviderText(configText, previousProviderName, currentAuth);
  }
  configText = setTopLevelStringField(configText, "model_provider_selected", provider.name);
  configText = updateModelProviderText(configText, provider.name, provider.config);

  writeConfigText(configPath, configText);
  if (!sameProvider) {
    writeAuth(targetAuth, authPath);
  }

  return {
    provider,
    authPath,
    configPath,
    configChanged: true,
    previousProviderName,
    sameProvider,
  };
}

module.exports = {
  authFromProvider,
  codexAuthPath,
  codexConfigPath,
  defaultCodexHome,
  loadModelProviders,
  parseTopLevelModelProviderSelected,
  parseTableName,
  parseTomlProviders,
  parseTomlString,
  parseTopLevelModelProvider,
  readAuth,
  selectModelProvider,
  setProviderAuthJsonText,
  setTopLevelStringField,
  unknownProviderName,
  updateModelProvider,
  updateModelProviderText,
};

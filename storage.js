const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getPrefix(guildId, defaultPrefix) {
  const data = load();
  return data.prefixes?.[guildId] ?? defaultPrefix;
}

function setPrefix(guildId, prefix) {
  const data = load();
  if (!data.prefixes) data.prefixes = {};
  data.prefixes[guildId] = prefix;
  save(data);
}

module.exports = { getPrefix, setPrefix };

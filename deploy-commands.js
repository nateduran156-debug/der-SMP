/**
 * Run this script ONCE to register slash commands with Discord.
 * Usage: node deploy-commands.js
 *
 * Uses DISCORD_GUILD_ID if set (instant, guild-only).
 * Falls back to global registration (takes up to 1 hour).
 */

require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("❌ DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set in .env");
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`📦 Queued: /${command.data.name}`);
  }
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log(`\n🔄 Registering ${commands.length} slash command(s)...`);

    let route;
    if (guildId) {
      route = Routes.applicationGuildCommands(clientId, guildId);
      console.log(`🏠 Registering to guild: ${guildId} (instant)`);
    } else {
      route = Routes.applicationCommands(clientId);
      console.log("🌍 Registering globally (may take up to 1 hour)");
    }

    const data = await rest.put(route, { body: commands });
    console.log(`✅ Successfully registered ${data.length} slash command(s).\n`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
})();

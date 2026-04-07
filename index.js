require("dotenv").config();
const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { getPrefix } = require("./storage");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);
  }
}

// Grab status helpers for auto-responses
const statusCommand = require("./commands/status");

// Ready event
client.once(Events.ClientReady, (c) => {
  console.log(`\n🤖 ${config.BOT_NAME} bot is online as ${c.user.tag}`);
  console.log(`📡 Monitoring: ${config.SERVER_IP}`);
  console.log(`🌐 Website: ${config.SERVER_WEBSITE}`);
  console.log(`⚡ Default prefix: ${config.PREFIX}`);
  c.user.setActivity(`${config.SERVER_IP} | /status`, { type: 3 });
});

// Slash command handler
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const msg = { content: "❌ An error occurred.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

// Message handler — prefix commands + auto-responses
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const lower = message.content.toLowerCase();
  const prefix = getPrefix(message.guildId, config.PREFIX);

  // Auto-response: IP (whole word match to avoid "ship", "trip", etc.)
  if (/\bip\b/.test(lower) && !lower.startsWith(prefix)) {
    try {
      await message.reply(
        `Ip: **${config.SERVER_IP}**\nPort_: **${config.SERVER_PORT}**`
      );
    } catch (err) {
      console.error("IP auto-response error:", err);
    }
    return;
  }

  // Auto-response: status
  if (lower.includes("status") && !lower.startsWith(prefix)) {
    try {
      const loadingMsg = await message.reply("⏳ Fetching server status...");
      const data = await statusCommand.fetchServerStatus();
      const embed = statusCommand.buildEmbed(data);
      await loadingMsg.edit({ content: "", embeds: [embed] });
    } catch (err) {
      await message.reply("❌ Failed to fetch server status. Please try again later.");
      console.error("Status auto-response error:", err);
    }
    return;
  }

  // Prefix command handler
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);
  if (!command || !command.executePrefix) return;

  try {
    await command.executePrefix(message, args);
  } catch (err) {
    console.error(`Error executing ${prefix}${commandName}:`, err);
    await message.reply("❌ An error occurred.");
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

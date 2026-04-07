require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
} = require("discord.js");
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

// Load all command files
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

// Auto-register slash commands with Discord on startup
async function registerCommands(clientId) {
  const commands = [];
  for (const command of client.commands.values()) {
    commands.push(command.data.toJSON());
  }

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);

  try {
    console.log("🔄 Registering slash commands...");
    const guildId = process.env.DISCORD_GUILD_ID;

    if (guildId) {
      // Guild registration — instant
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✅ Slash commands registered to guild ${guildId} (instant)`);
    } else {
      // Global registration — up to 1 hour to propagate
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("✅ Slash commands registered globally (may take up to 1 hour)");
    }
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err.message);
  }
}

// Ready event
client.once(Events.ClientReady, async (c) => {
  console.log(`\n🤖 ${config.BOT_NAME} is online as ${c.user.tag}`);
  console.log(`📡 Monitoring: ${config.SERVER_IP}`);
  console.log(`⚡ Default prefix: ${config.PREFIX}`);

  c.user.setActivity(`${config.SERVER_IP} | /status`, { type: 3 });

  // Auto-register slash commands on every startup
  await registerCommands(c.user.id);
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

// Message handler — auto-responses + prefix commands
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const lower = message.content.toLowerCase();

  // Auto-responses only apply in servers (not DMs)
  if (message.guildId) {
    const prefix = getPrefix(message.guildId, config.PREFIX);

    // Skip auto-responses if it's a bot command
    const isCommand = message.content.startsWith(prefix);

    // Auto-response: IP
    if (!isCommand && /\bip\b/.test(lower)) {
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
    if (!isCommand && /\bstatus\b/.test(lower)) {
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

    // Prefix commands
    if (isCommand) {
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
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

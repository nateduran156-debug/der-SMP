require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const dgram = require("dgram");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const SERVER_HOST = process.env.MC_SERVER_HOST || "135.148.134.45";
const SERVER_PORT = parseInt(process.env.MC_SERVER_PORT || "19132", 10);
const UPDATE_INTERVAL_MS = 60 * 1000;

const MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
  0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
]);

function pingBedrock(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for server response"));
    }, timeoutMs);

    const packet = Buffer.alloc(1 + 8 + 16 + 8);
    packet.writeUInt8(0x01, 0);
    packet.writeBigInt64BE(0n, 1);
    MAGIC.copy(packet, 9);
    packet.writeBigInt64BE(BigInt(Math.floor(Math.random() * 0xffffffff)), 25);

    socket.on("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      try {
        const strLen = msg.readUInt16BE(33);
        const motd = msg.slice(35, 35 + strLen).toString("utf8");
        // MCPE;name;protocol;version;online;max;serverid;levelname;gamemode;...
        const parts = motd.split(";");
        resolve({
          online: parseInt(parts[4], 10) || 0,
          max: parseInt(parts[5], 10) || 0,
          name: parts[1] || "Minecraft Server",
          subMotd: parts[7] || "",
          version: parts[3] || "Unknown",
        });
      } catch (err) {
        reject(new Error("Failed to parse server response: " + err.message));
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.send(packet, 0, packet.length, port, host);
  });
}

async function getServerStatus() {
  try {
    return await pingBedrock(SERVER_HOST, SERVER_PORT);
  } catch (err) {
    console.error(`Failed to query ${SERVER_HOST}:${SERVER_PORT} —`, err.message);
    return null;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function updateChannel() {
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) {
    console.error(`Voice channel ${CHANNEL_ID} not found. Make sure the bot has access to it.`);
    return;
  }

  const status = await getServerStatus();
  const name = status !== null ? `Players Online: ${status.online}` : `Players Online: N/A`;

  try {
    await channel.setName(name);
    console.log(`[${new Date().toISOString()}] Updated channel to: "${name}"`);
  } catch (err) {
    console.error("Failed to update channel name:", err.message);
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toLowerCase();

  if (content === "!status") {
    const status = await getServerStatus();

    if (!status) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🔴 Server Offline")
        .setDescription("Could not reach the server. It may be offline.")
        .setFooter({ text: `${SERVER_HOST}:${SERVER_PORT}` })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    const motdLine = status.subMotd ? `${status.name} | ${status.subMotd}` : status.name;

    const embed = new EmbedBuilder()
      .setColor(0x00c853)
      .setTitle(`🟢 ${status.name}`)
      .setDescription(`\`${motdLine}\``)
      .addFields(
        { name: "🌐 IP", value: `\`${SERVER_HOST}\``, inline: true },
        { name: "👥 Players", value: `${status.online} / ${status.max}`, inline: true },
        { name: "📌 Version", value: `Bedrock ${status.version}`, inline: true },
        {
          name: "👥 Online Players",
          value: "_Player list is not available for Bedrock servers_",
          inline: false,
        }
      )
      .setFooter({ text: `${status.name}` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  if (content === "!help") {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Commands")
      .addFields(
        { name: "`!status`", value: "Check the Minecraft server status and player count", inline: false },
        { name: "`!ip`", value: "Get the server connection info", inline: false },
        { name: "`!help`", value: "Show this message", inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  if (
    content === "!ip" ||
    content.includes("what is the ip") ||
    content.includes("what's the ip") ||
    content.includes("whats the ip") ||
    content.includes("server ip")
  ) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Server Connection Info")
      .addFields(
        { name: "🌐 IP", value: `\`${SERVER_HOST}\``, inline: true },
        { name: "🔌 Port", value: `\`${SERVER_PORT}\``, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Monitoring: ${SERVER_HOST}:${SERVER_PORT}`);

  if (!CHANNEL_ID) {
    console.error("ERROR: VOICE_CHANNEL_ID is not set in your .env file. Please add it and restart.");
    process.exit(1);
  }

  console.log(`Updating voice channel ${CHANNEL_ID} every minute`);

  await updateChannel();
  setInterval(updateChannel, UPDATE_INTERVAL_MS);
});

client.login(TOKEN);

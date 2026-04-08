require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const dgram = require("dgram");
const net = require("net");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const SERVER_HOST = process.env.MC_SERVER_HOST || "135.148.134.45";
const BEDROCK_PORT = parseInt(process.env.MC_SERVER_PORT || "19132", 10);
const JAVA_PORT = parseInt(process.env.MC_JAVA_PORT || "25565", 10);
const UPDATE_INTERVAL_MS = 60 * 1000;

// ── Java server list ping (TCP) ──────────────────────────────────────────────

function writeVarInt(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function writeString(str) {
  const strBuf = Buffer.from(str, "utf8");
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

function buildHandshake(host, port) {
  const packetId = writeVarInt(0x00);
  const protocolVersion = writeVarInt(-1);  // -1 = ping any version
  const serverAddress = writeString(host);
  const serverPort = Buffer.alloc(2);
  serverPort.writeUInt16BE(port, 0);
  const nextState = writeVarInt(1);          // 1 = status

  const data = Buffer.concat([packetId, protocolVersion, serverAddress, serverPort, nextState]);
  return Buffer.concat([writeVarInt(data.length), data]);
}

function buildStatusRequest() {
  return Buffer.from([0x01, 0x00]); // length=1, packetId=0x00
}

function readVarInt(buf, offset = 0) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if (!(byte & 0x80)) break;
  }
  return { value: result, offset: pos };
}

function pingJava(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let chunks = [];
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      socket.destroy();
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Java ping timed out"));
    }, timeoutMs);

    socket.once("connect", () => {
      socket.write(buildHandshake(host, port));
      socket.write(buildStatusRequest());
    });

    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);

      try {
        // Read packet length VarInt
        const lenResult = readVarInt(buf, 0);
        const totalLength = lenResult.value + lenResult.offset;
        if (buf.length < totalLength) return; // need more data

        // Read packet ID VarInt
        const idResult = readVarInt(buf, lenResult.offset);
        // Read JSON string length VarInt
        const strLenResult = readVarInt(buf, idResult.offset);
        const jsonStart = strLenResult.offset;
        const jsonEnd = jsonStart + strLenResult.value;

        if (buf.length < jsonEnd) return; // need more data

        const json = JSON.parse(buf.slice(jsonStart, jsonEnd).toString("utf8"));
        cleanup();
        resolve(json);
      } catch (_) {
        // Keep buffering
      }
    });

    socket.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}

// ── Bedrock UDP ping (for voice channel counter) ─────────────────────────────

const MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
  0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
]);

function pingBedrock(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Bedrock ping timed out"));
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
        const parts = motd.split(";");
        resolve({
          online: parseInt(parts[4], 10) || 0,
          max: parseInt(parts[5], 10) || 0,
          name: parts[1] || "Minecraft Server",
          subMotd: parts[7] || "",
          version: parts[3] || "Unknown",
        });
      } catch (err) {
        reject(new Error("Failed to parse Bedrock response: " + err.message));
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.send(packet, 0, packet.length, port, host);
  });
}

// ── Unified status fetcher ────────────────────────────────────────────────────

async function getFullStatus() {
  let javaData = null;
  let bedrockData = null;

  // Try Java first (gives player names)
  try {
    javaData = await pingJava(SERVER_HOST, JAVA_PORT);
  } catch (err) {
    console.error(`Java ping failed: ${err.message}`);
  }

  // Try Bedrock (fallback / for voice channel)
  try {
    bedrockData = await pingBedrock(SERVER_HOST, BEDROCK_PORT);
  } catch (err) {
    console.error(`Bedrock ping failed: ${err.message}`);
  }

  if (!javaData && !bedrockData) return null;

  if (javaData) {
    const players = (javaData.players?.sample || []).map((p) => p.name);
    return {
      online: javaData.players?.online ?? 0,
      max: javaData.players?.max ?? 0,
      name: typeof javaData.description === "string"
        ? javaData.description
        : javaData.description?.text ?? "Minecraft Server",
      version: javaData.version?.name ?? "Unknown",
      players,
    };
  }

  // Bedrock fallback (no player names available)
  return {
    online: bedrockData.online,
    max: bedrockData.max,
    name: bedrockData.name,
    version: `Bedrock ${bedrockData.version}`,
    players: [],
  };
}

async function getBedrockPlayerCount() {
  try {
    const data = await pingBedrock(SERVER_HOST, BEDROCK_PORT);
    return data.online;
  } catch {
    // If Bedrock fails, try Java count
    try {
      const data = await pingJava(SERVER_HOST, JAVA_PORT);
      return data.players?.online ?? null;
    } catch {
      return null;
    }
  }
}

// ── Discord client ────────────────────────────────────────────────────────────

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
    console.error(`Voice channel ${CHANNEL_ID} not found.`);
    return;
  }

  const count = await getBedrockPlayerCount();
  const name = count !== null ? `Players Online: ${count}` : `Players Online: N/A`;

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
    const loadingMsg = await message.reply("⏳ Fetching server status...");
    const status = await getFullStatus();

    if (!status) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🔴 Server Offline")
        .setDescription("Could not reach the server. It may be offline.")
        .setFooter({ text: `${SERVER_HOST}` })
        .setTimestamp();
      return loadingMsg.edit({ content: "", embeds: [embed] });
    }

    const playerList = status.players.length > 0
      ? status.players.join(", ")
      : "_No players online_";

    const embed = new EmbedBuilder()
      .setColor(0x00c853)
      .setTitle(`🟢 ${status.name}`)
      .addFields(
        { name: "🌐 IP", value: `\`${SERVER_HOST}\``, inline: true },
        { name: "👥 Players", value: `${status.online} / ${status.max}`, inline: true },
        { name: "📌 Version", value: status.version, inline: true },
        { name: "👥 Online Players", value: playerList, inline: false }
      )
      .setFooter({ text: `${status.name}` })
      .setTimestamp();

    return loadingMsg.edit({ content: "", embeds: [embed] });
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
    content.includes("server ip") ||
    /\bip\b/.test(content)
  ) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Server Connection Info")
      .addFields(
        { name: "🌐 IP", value: `\`${SERVER_HOST}\``, inline: true },
        { name: "🔌 Port", value: `\`${BEDROCK_PORT}\``, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Monitoring: ${SERVER_HOST} (Java: ${JAVA_PORT}, Bedrock: ${BEDROCK_PORT})`);

  if (!CHANNEL_ID) {
    console.error("ERROR: VOICE_CHANNEL_ID is not set in your .env file.");
    process.exit(1);
  }

  console.log(`Updating voice channel ${CHANNEL_ID} every minute`);
  await updateChannel();
  setInterval(updateChannel, UPDATE_INTERVAL_MS);
});

client.login(TOKEN);

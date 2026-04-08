require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const dgram = require("dgram");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const SERVER_HOST = process.env.MC_SERVER_HOST || "135.148.134.45";
const SERVER_PORT = parseInt(process.env.MC_SERVER_PORT || "19132", 10);
const UPDATE_INTERVAL_MS = 60 * 1000;

// Bedrock/RakNet unconnected ping magic bytes
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

    // Build unconnected ping packet (0x01)
    const packet = Buffer.alloc(1 + 8 + 16 + 8);
    packet.writeUInt8(0x01, 0);                     // packet ID
    // 8-byte timestamp (just use 0)
    packet.writeBigInt64BE(0n, 1);
    MAGIC.copy(packet, 9);                           // 16 magic bytes
    // 8-byte client GUID (random)
    packet.writeBigInt64BE(BigInt(Math.floor(Math.random() * 0xffffffff)), 25);

    socket.on("message", (msg) => {
      clearTimeout(timer);
      socket.close();

      try {
        // Response is 0x1c (unconnected pong)
        // Layout: 1 ID + 8 timestamp + 8 serverGUID + 16 magic + 2 length + N string
        const strLen = msg.readUInt16BE(33);
        const motd = msg.slice(35, 35 + strLen).toString("utf8");
        // MOTD: MCPE;name;protocol;version;online;max;...
        const parts = motd.split(";");
        const online = parseInt(parts[4], 10);
        resolve(isNaN(online) ? 0 : online);
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

async function getPlayerCount() {
  try {
    return await pingBedrock(SERVER_HOST, SERVER_PORT);
  } catch (err) {
    console.error(`Failed to query ${SERVER_HOST}:${SERVER_PORT} —`, err.message);
    return null;
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function updateChannel() {
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) {
    console.error(`Voice channel ${CHANNEL_ID} not found. Make sure the bot has access to it.`);
    return;
  }

  const count = await getPlayerCount();
  const name = count !== null ? `Players Online: ${count}` : `Players Online: N/A`;

  try {
    await channel.setName(name);
    console.log(`[${new Date().toISOString()}] Updated channel to: "${name}"`);
  } catch (err) {
    console.error("Failed to update channel name:", err.message);
  }
}

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

require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { statusBedrock } = require("minecraft-server-util");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const SERVER_HOST = process.env.MC_SERVER_HOST || "135.148.134.45";
const SERVER_PORT = parseInt(process.env.MC_SERVER_PORT || "19132", 10);
const UPDATE_INTERVAL_MS = 60 * 1000;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getPlayerCount() {
  try {
    const response = await statusBedrock(SERVER_HOST, SERVER_PORT, {
      timeout: 5000,
    });
    return response.players.online;
  } catch (err) {
    console.error(`Failed to query server ${SERVER_HOST}:${SERVER_PORT} —`, err.message);
    return null;
  }
}

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
    console.log(`[${new Date().toISOString()}] Updated channel name to: "${name}"`);
  } catch (err) {
    console.error("Failed to update channel name:", err.message);
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Monitoring: ${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`Updating voice channel ${CHANNEL_ID} every minute`);

  await updateChannel();
  setInterval(updateChannel, UPDATE_INTERVAL_MS);
});

client.login(TOKEN);

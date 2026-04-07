const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");

async function fetchServerStatus() {
  const res = await fetch(config.MCSTATUS_API);
  if (!res.ok) throw new Error(`mcstatus API returned ${res.status}`);
  return res.json();
}

function buildEmbed(data) {
  const online = data.online;

  if (!online) {
    return new EmbedBuilder()
      .setTitle(`🔴 ${config.BOT_NAME}`)
      .setDescription("The server is currently **offline**.")
      .setColor(config.EMBED_COLOR_OFFLINE)
      .addFields({ name: "IP", value: `\`${config.SERVER_IP}\``, inline: true })
      .setTimestamp()
      .setFooter({ text: config.BOT_NAME });
  }

  const playersOnline = data.players?.online ?? 0;
  const playersMax = data.players?.max ?? 0;
  const version = data.version?.name_clean ?? "Unknown";
  const motd = data.motd?.clean ?? "No MOTD";
  const playerList =
    data.players?.list && data.players.list.length > 0
      ? data.players.list.map((p) => p.name_clean || p.name_raw).join(", ")
      : null;

  const embed = new EmbedBuilder()
    .setTitle(`🟢 ${config.BOT_NAME}`)
    .setDescription(`\`\`\`${motd}\`\`\``)
    .setColor(config.EMBED_COLOR)
    .addFields(
      { name: "📡 IP", value: `\`${config.SERVER_IP}\``, inline: true },
      { name: "👥 Players", value: `${playersOnline} / ${playersMax}`, inline: true },
      { name: "🕹️ Version", value: version, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: config.BOT_NAME });

  if (playerList) {
    embed.addFields({ name: "🧑‍🤝‍🧑 Online Players", value: playerList, inline: false });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription(`Check the status of ${config.BOT_NAME}`),

  fetchServerStatus,
  buildEmbed,

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const data = await fetchServerStatus();
      const embed = buildEmbed(data);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({
        content: "❌ Failed to fetch server status. Please try again later.",
      });
      console.error("Status command error:", err);
    }
  },

  async executePrefix(message) {
    try {
      const loadingMsg = await message.reply("⏳ Fetching server status...");
      const data = await fetchServerStatus();
      const embed = buildEmbed(data);
      await loadingMsg.edit({ content: "", embeds: [embed] });
    } catch (err) {
      await message.reply("❌ Failed to fetch server status. Please try again later.");
      console.error("Status prefix command error:", err);
    }
  },
};

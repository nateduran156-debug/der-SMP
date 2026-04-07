const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { setPrefix } = require("../storage");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("Change the bot's prefix for text commands")
    .addStringOption((option) =>
      option
        .setName("new_prefix")
        .setDescription("The new prefix to use (e.g. !, ?, $, .)")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(5)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const newPrefix = interaction.options.getString("new_prefix");

    setPrefix(interaction.guildId, newPrefix);

    const embed = new EmbedBuilder()
      .setTitle("✅ Prefix Updated")
      .setDescription(`The prefix has been changed to \`${newPrefix}\``)
      .addFields({ name: "Example", value: `\`${newPrefix}status\`` })
      .setColor(config.EMBED_COLOR)
      .setFooter({ text: config.BOT_NAME })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

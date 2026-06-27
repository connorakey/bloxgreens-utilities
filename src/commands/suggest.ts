import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import type { Command } from "../types/Command";
import channelIds from "../../config/config.json";

export const suggest: Command = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion")
    .addIntegerOption((option) =>
      option
        .setName("type")
        .setDescription("Suggestion Type")
        .setRequired(true)
        .addChoices(
          { name: "Game", value: 1 },
          { name: "Server", value: 2 },
          { name: "Other", value: 3 }
        )
    )
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Suggestion Title")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Suggestion Description")
        .setRequired(true)
    ),

  async execute(interaction) {
    const type = interaction.options.getInteger("type", true);
    const title = interaction.options.getString("title", true);
    const description = interaction.options.getString("description", false);

    const typeName = (type: number): string => {
      switch (type) {
        case 1:
          return "Game";
        case 2:
          return "Server";
        case 3:
          return "Other";
        default:
          return "Unknown";
      }
    };

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || "No description provided.")
      .setFooter({ text: `Suggestion Type: ${typeName(type)}` })
      .setColor(0xff0000)
      .setTimestamp();

    const suggestionsChannel = interaction.guild?.channels.cache.get(
      channelIds.channel_ids.suggestions
    );

    if (!suggestionsChannel || !suggestionsChannel.isTextBased()) {
      await interaction.reply({
        content: "Suggestions channel not found, if this issue persists, please open a ticket and send a screenshot of this error.", 
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const message = await suggestionsChannel.send({ embeds: [embed] });
    await message.react("👍");
    await message.react("👎");


    await interaction.reply({
      content: "Your suggestion has been submitted!",
      flags: MessageFlags.Ephemeral,
    });
   },
};

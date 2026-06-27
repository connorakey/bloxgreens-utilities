import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/Command';

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription("Check the bot's latency."),

  async execute(interaction) {
    const response = await interaction.reply({
      content: 'Pinging...',
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });
    const latency = response.resource?.message?.createdTimestamp
      ? response.resource.message.createdTimestamp -
        interaction.createdTimestamp
      : 0;

    await interaction.editReply(`Pong! Latency: ${latency}ms`);
  },
};

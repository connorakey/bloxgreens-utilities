import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { Command } from '../types/Command';

import config from '../../config/config.json';

const activeShifts = new Map<
  string,
  {
    messageId: string;
    hostId: string;
    cohostId: string | null;
    shiftApproverId: string;
    promotional: boolean;
    shiftTime: string;
  }
>();

export const shift: Command = {
  data: new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Manage/View shifts')

    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a new shift')
        .addStringOption((option) =>
          option
            .setName('shift_time')
            .setDescription(
              'Shift time HH:mm-HH:mm (e.g. 14:00-16:00). Create 24h ahead. Must attend full shift; no public use.',
            )
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('promotional')
            .setDescription(
              'Is this a promotional shift? Requires shift approver presence.',
            )
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('cohost')
            .setDescription('Cohost for the shift (optional)')
            .setRequired(false),
        ),
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('End an active shift')
        .addStringOption((option) =>
          option
            .setName('shift_time')
            .setDescription(
              'Shift time to end (HH:mm-HH:mm). Must match your shift or cohosted shift.',
            )
            .setRequired(true),
        ),
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription(
          'List all active shifts (available to all users, including non-staff)',
        ),
    ) as Command['data'],

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      const shiftTime = interaction.options.getString('shift_time', true);
      const cohost = interaction.options.getUser('cohost', false);
      const promotional =
        interaction.options.getBoolean('promotional', false) ?? false;

      if (
        interaction.inCachedGuild() &&
        interaction.member.roles.cache.has(config.roles.shifts.requester)
      ) {
        const embed = new EmbedBuilder()
          .setTitle('❗ Please Confirm Shift Request ❗')
          .setDescription(
            `Please confirm your shift request: <@${interaction.user.id}>.\n\n` +
              `**Shift Time:** ${shiftTime}\n` +
              `**Cohost:** ${cohost ? `<@${cohost.id}>` : 'None'}\n` +
              `**Promotional Shift:** ${promotional ? 'Yes' : 'No'}\n\n` +
              `Confirm this request by reacting with ✅ within the next 5 minutes, or by reacting with ❌ to deny it.\n` +
              `Ensure that you have read the shift guidelines before approving, and that you are available to attend the shift if it is approved.\n` +
              `You have five (5) minutes to confirm this request, after which it will be automatically denied.`,
          )
          .setColor(0x00ff00);
        const message = await interaction.reply({
          embeds: [embed],
          fetchReply: true,
        });

        const filter = (reaction: any, user: any) => {
          return ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
        };

        const collector = message.createReactionCollector({
          filter,
          time: 5 * 60 * 1000,
        });

        collector.on('collect', async (reaction, user) => {
          if (reaction.emoji.name === '✅') {
            collector.stop('approved');
            await message.delete().catch(() => {});

            await interaction.followUp({
              content: `Your shift request has been forwarded to our shift approvers for review. You will be notified once a decision has been made, please ensure that your direct messages are open so that you can receive the decision. Thank you for your patience!`,
            });
          }

          if (reaction.emoji.name === '❌') {
            collector.stop('denied');
            await message.delete().catch(() => {});

            await interaction.followUp({
              content: `Your shift request has been cancelled.`,
            });
          }
        });

        collector.on('end', async (_, reason) => {
          if (reason === 'time') {
            await message.delete().catch(() => {});

            await interaction.followUp({
              content: 'Shift request timed out.',
            });
          }
        });

        await Promise.all([message.react('✅'), message.react('❌')]);
      } else {
        await interaction.reply({
          content: 'You do not have permission to create a shift.',
          ephemeral: true,
        });
      }
    }

    if (subcommand === 'end') {
      const shiftTime = interaction.options.getString('shift_time', true);
      // TODO: end shift logic
    }

    if (subcommand === 'list') {
      // TODO: list logic
    }
  },
};

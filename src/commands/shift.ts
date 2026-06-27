import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { Command } from '../types/Command';
import { sendToShiftApprover } from '../services/shiftApprovalService';
import {
  cancelShiftByShiftTime,
  markShiftStartedByShiftTime,
} from '../services/shiftDueMonitorService';
import { getShiftByShiftTime, listActiveShifts } from '../services/shiftStore';
import config from '../../config/config.json';

const SHIFT_TIME_FORMAT =
  /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2]) ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function formatShiftTimestamp(shiftTime: string, ms: number) {
  return `\`${shiftTime}\` <t:${Math.floor(ms / 1000)}:R>`;
}

function getShiftListStatus(shift: {
  startMs: number;
  endMs: number;
  startedAt: number | null;
  concludedAt: number | null;
}) {
  if (shift.concludedAt) {
    return 'Concluded';
  }

  if (Date.now() < shift.startMs) {
    return 'Upcoming';
  }

  if (shift.startedAt) {
    return 'Live';
  }

  return 'Pending Start';
}

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
              'Shift date/time DD-MM HH:mm-HH:mm (e.g. 03-07 14:00-16:00).',
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
        .setName('start')
        .setDescription('Mark a shift as started')
        .addStringOption((option) =>
          option
            .setName('shift_time')
            .setDescription(
              'Shift date/time to start (DD-MM HH:mm-HH:mm). Must match your shift.',
            )
            .setRequired(true),
        ),
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('cancel')
        .setDescription('Cancel an active shift')
        .addStringOption((option) =>
          option
            .setName('shift_time')
            .setDescription(
              'Shift date/time to cancel (DD-MM HH:mm-HH:mm). Must match an active shift.',
            )
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('delete_now')
            .setDescription(
              'Delete the Trello card immediately instead of starting the 12 hour deletion timer.',
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

      if (!SHIFT_TIME_FORMAT.test(shiftTime)) {
        await interaction.reply({
          content:
            'Invalid shift time format. Please use `DD-MM HH:mm-HH:mm`, for example `03-07 14:00-16:00`.',
          ephemeral: true,
        });
        return;
      }

      if (
        interaction.inCachedGuild() &&
        interaction.member.roles.cache.has(config.roles.shifts.requester)
      ) {
        const embed = new EmbedBuilder()
          .setTitle('❗ Please Confirm Shift Request Submission ❗')
          .setDescription(
            `Please confirm your shift request submittion: <@${interaction.user.id}>.\n\n` +
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
            sendToShiftApprover(
              interaction,
              shiftTime,
              interaction.user.id,
              cohost?.id ?? null,
              promotional,
            );
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

    if (subcommand === 'start') {
      const shiftTime = interaction.options.getString('shift_time', true);
      const shift = getShiftByShiftTime(shiftTime);

      if (!shift) {
        await interaction.reply({
          content: `No matching shift was found for ${shiftTime}.`,
          ephemeral: true,
        });
        return;
      }

      const approverRoleId = config.roles.shifts.approver;
      const member = interaction.inCachedGuild()
        ? interaction.member
        : await interaction.guild?.members
            .fetch(interaction.user.id)
            .catch(() => null);

      const isAllowed =
        member?.id === shift.hostDiscordId ||
        member?.id === shift.cohostDiscordId ||
        member?.roles.cache.has(approverRoleId) === true;

      if (!isAllowed) {
        await interaction.reply({
          content:
            'You do not have permission to start this shift. Only the host, co-host, or a shift approver can use this command.',
          ephemeral: true,
        });
        return;
      }

      const started = await markShiftStartedByShiftTime(shiftTime);

      await interaction.reply({
        content: started
          ? `Shift ${shiftTime} has been marked as started.`
          : `No matching shift was found for ${shiftTime}.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'cancel') {
      const shiftTime = interaction.options.getString('shift_time', true);
      const deleteNow = interaction.options.getBoolean('delete_now', true);
      const approverRoleId = config.roles.shifts.approver;
      const member = interaction.inCachedGuild()
        ? interaction.member
        : await interaction.guild?.members
            .fetch(interaction.user.id)
            .catch(() => null);

      if (!member?.roles.cache.has(approverRoleId)) {
        await interaction.reply({
          content: 'Only shift approvers can cancel shifts.',
          ephemeral: true,
        });
        return;
      }

      const cancelled = await cancelShiftByShiftTime(shiftTime, deleteNow);

      await interaction.reply({
        content: cancelled
          ? deleteNow
            ? `Shift ${shiftTime} has been deleted immediately.`
            : `Shift ${shiftTime} has been cancelled and will be deleted after 12 hours.`
          : `No matching shift was found for ${shiftTime}.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'list') {
      const shifts = listActiveShifts();

      if (shifts.length === 0) {
        await interaction.reply({
          content: 'There are no active shifts right now.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Active Shifts')
        .setColor(0x00b2ff)
        .setDescription(
          shifts
            .map((shift) => {
              const cohost = shift.cohostUsername ?? 'None';

              return [
                `${formatShiftTimestamp(shift.shiftTime, shift.startMs)} - ${getShiftListStatus(shift)}`,
                `Host: ${shift.hostUsername}`,
                `Co-Host: ${cohost}`,
                `Promotional: ${shift.promotional ? 'Yes' : 'No'}`,
              ].join('\n');
            })
            .join('\n\n'),
        );

      await interaction.reply({
        embeds: [embed],
      });
    }
  },
};

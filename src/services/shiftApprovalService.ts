import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  User,
} from 'discord.js';
import config from '../../config/config.json';
import { sendToShiftTrello } from './shiftTrelloService';
import { formatShiftTimeWithTimestamp } from '../utils/shiftTime';

const SHIFT_REQUEST_TIMEOUT_MS = 48 * 60 * 60 * 1000;

type ShiftDecision = 'approved' | 'declined';

export async function sendToShiftApprover(
  interaction: ChatInputCommandInteraction,
  shiftTime: string,
  hostId: string,
  cohostId: string | null,
  promotional: boolean,
) {
  const channelId =
    config.channel_ids.shift_requests || config.channel_ids.shifts;
  const channel = await interaction.client.channels.fetch(channelId);

  if (!channel?.isSendable()) {
    return;
  }

  const formattedShiftTime = formatShiftTimeWithTimestamp(shiftTime);
  const requestDescription =
    `**Shift Time:** ${formattedShiftTime}\n` +
    `**Host:** <@${hostId}>\n` +
    `**Cohost:** ${cohostId ? `<@${cohostId}>` : 'None'}\n` +
    `**Promotional:** ${promotional ? 'Yes' : 'No'}`;

  const embed = new EmbedBuilder()
    .setTitle('❗ New Shift Approval Request ❗')
    .setDescription(
      `${requestDescription}\n\n` +
        'Please review and approve or deny this shift request. Keep in mind that promotional shifts require the shift approver to be present.',
    )
    .setColor(0xff0000);

  const approveCustomId = `shift-approve:${interaction.id}`;
  const declineCustomId = `shift-decline:${interaction.id}`;

  const decisionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(approveCustomId)
      .setEmoji('✅')
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(declineCustomId)
      .setEmoji('❌')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  const message = await channel.send({
    embeds: [embed],
    components: [decisionRow],
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: SHIFT_REQUEST_TIMEOUT_MS,
  });

  let decisionSettled = false;

  collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
    if (
      ![approveCustomId, declineCustomId].includes(buttonInteraction.customId)
    ) {
      return;
    }

    if (decisionSettled) {
      await buttonInteraction.deferUpdate().catch(() => {});
      return;
    }

    const member = await buttonInteraction.guild?.members
      .fetch(buttonInteraction.user.id)
      .catch(() => null);

    if (!member?.roles.cache.has(config.roles.shifts.approver)) {
      await buttonInteraction
        .reply({
          content: 'Only shift approvers can decide shift requests.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    const decision: ShiftDecision =
      buttonInteraction.customId === approveCustomId ? 'approved' : 'declined';
    decisionSettled = true;
    const approved = decision === 'approved';
    const user: User = buttonInteraction.user;
    const host = await interaction.client.users.fetch(hostId).catch(() => null);

    collector.stop(decision);
    await buttonInteraction.deferUpdate().catch(() => {});

    if (approved) {
      await sendToShiftTrello(
        shiftTime,
        hostId,
        cohostId,
        promotional,
        user.id,
      ).catch((error) => {
        console.error('Failed to create Trello shift card:', error);
      });
    }

    await host
      ?.send(
        approved
          ? `Your shift request for ${formattedShiftTime} has been approved by <@${user.id}>. Please ensure that you are available to attend the shift. If you have any questions, please reach out to the shift approver. If you are unable to attend the shift, please contact the shift approver as soon as possible.`
          : `Your shift request for ${formattedShiftTime} has been declined by <@${user.id}>. If you have any questions, please reach out to the shift approver.`,
      )
      .catch(() => {});

    await message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setTitle(
            approved
              ? '✅ Shift Request Approved ✅'
              : '❌ Shift Request Declined ❌',
          )
          .setColor(approved ? 0x00ff00 : 0xff0000)
          .setDescription(
            `${requestDescription}\n\nThis shift request has been ${decision} by <@${user.id}>.`,
          ),
      ],
      components: [],
    });
  });
}

import { EmbedBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  MessageReaction,
  User,
} from 'discord.js';
import config from '../../config/config.json';

const DECISION_REACTIONS = ['✅', '❌'] as const;
const SHIFT_REQUEST_TIMEOUT_MS = 48 * 60 * 60 * 1000;

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

  const requestDescription =
    `**Shift Time:** ${shiftTime}\n` +
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

  const message = await channel.send({ embeds: [embed] });

  const filter = (reaction: MessageReaction, user: User) =>
    DECISION_REACTIONS.includes(
      reaction.emoji.name as (typeof DECISION_REACTIONS)[number],
    ) && !user.bot;

  const collector = message.createReactionCollector({
    filter,
    time: SHIFT_REQUEST_TIMEOUT_MS,
  });

  collector.on('collect', async (reaction, user) => {
    const member = await interaction.guild?.members
      .fetch(user.id)
      .catch(() => null);

    if (!member?.roles.cache.has(config.roles.shifts.approver)) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    const approved = reaction.emoji.name === '✅';
    const decision = approved ? 'approved' : 'denied';
    const host = await interaction.client.users.fetch(hostId).catch(() => null);

    collector.stop(decision);

    await host
      ?.send(
        approved
          ? `Your shift request for ${shiftTime} has been approved by <@${user.id}>. Please ensure that you are available to attend the shift. If you have any questions, please reach out to the shift approver. If you are unable to attend the shift, please contact the shift approver as soon as possible.`
          : `Your shift request for ${shiftTime} has been denied by <@${user.id}>. If you have any questions, please reach out to the shift approver.`,
      )
      .catch(() => {});

    await message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setTitle(
            approved
              ? '✅ Shift Request Approved ✅'
              : '❌ Shift Request Denied ❌',
          )
          .setColor(approved ? 0x00ff00 : 0xff0000)
          .setDescription(
            `${requestDescription}\n\nThis shift request has been ${decision} by <@${user.id}>.`,
          ),
      ],
    });
  });

  await Promise.all([
    message.react(DECISION_REACTIONS[0]),
    message.react(DECISION_REACTIONS[1]),
  ]);
}

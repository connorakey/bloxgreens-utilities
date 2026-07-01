import 'dotenv/config';
import { registerCommands } from './utils/registerCommands';
import { handleInteraction } from './utils/handleInteraction';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { startShiftDueMonitor } from './services/shiftDueMonitorService';

const STATUS_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const statusMessagesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../config/status_messages.csv',
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

function parseStatusMessagesCsv(content: string): string[] {
  const messages: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        field += character;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (
      !inQuotes &&
      (character === ',' || character === '\n' || character === '\r')
    ) {
      const message = field.trim();
      if (message) messages.push(message);

      field = '';
      if (character === '\r' && nextCharacter === '\n') index += 1;
      continue;
    }

    field += character;
  }

  const message = field.trim();
  if (message) messages.push(message);

  return messages;
}

function getRandomStatusMessage(): string | null {
  const content = readFileSync(statusMessagesPath, 'utf8');
  const messages = parseStatusMessagesCsv(content);

  if (messages.length === 0) return null;

  return messages[Math.floor(Math.random() * messages.length)]!;
}

function updateRandomStatus(): void {
  try {
    const message = getRandomStatusMessage();

    if (!message) {
      console.warn('No status messages found in config/status_messages.csv.');
      return;
    }

    client.user?.setActivity({
      name: message,
      type: ActivityType.Custom,
    });
    console.log(`Updated bot status: ${message}`);
  } catch (error) {
    console.error('Failed to update bot status:', error);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  updateRandomStatus();
  setInterval(updateRandomStatus, STATUS_UPDATE_INTERVAL_MS);
  await registerCommands(client);
  await startShiftDueMonitor(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await handleInteraction(interaction);
});

client.login(process.env.DISCORD_BOT_TOKEN);

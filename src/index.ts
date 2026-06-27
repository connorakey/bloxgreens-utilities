import 'dotenv/config';
import { registerCommands } from './utils/registerCommands';
import { handleInteraction } from './utils/handleInteraction';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { createTrelloClient } from 'trello.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  await registerCommands(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await handleInteraction(interaction);
});

client.login(process.env.DISCORD_BOT_TOKEN);

import 'dotenv/config';
import { registerCommands } from './utils/registerCommands';
import { handleInteraction } from './utils/handleInteraction';
import { Client, Events, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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

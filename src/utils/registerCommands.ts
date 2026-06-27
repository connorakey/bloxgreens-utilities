import type { Client } from "discord.js";
import { commands } from "../commands";

export async function registerCommands(client: Client) {
  if (!client.application) {
    throw new Error("Cannot register commands before the Discord client is ready.");
  }

  const commandData = commands.map((command) => command.data.toJSON());

  await client.application.commands.set(commandData);
  console.log(`Registered ${commandData.length} application command(s).`);
}

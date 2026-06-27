import { Collection } from "discord.js";
import { ping } from "./ping";
import type { Command } from "../types/Command";

export const commands = new Collection<string, Command>();

commands.set(ping.data.name, ping);

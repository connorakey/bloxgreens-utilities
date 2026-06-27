import { createTrelloClient } from 'trello.js';

const board = '6a3f3f551c2e98987fecad69';

const PLANNED_LABEL_NAME = 'Planned';
const PLANNED_LABEL_COLOR = 'yellow';
const TARGET_LIST_INDEX = 0;

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required to create a Trello shift card.`);
  }

  return value;
}

function parseShiftDueDate(shiftTime: string) {
  const match = shiftTime.match(
    /^(?<day>0[1-9]|[12]\d|3[01])-(?<month>0[1-9]|1[0-2]) (?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)-([01]\d|2[0-3]):[0-5]\d$/,
  );

  if (!match?.groups) {
    throw new Error('Shift time must be in DD-MM HH:mm-HH:mm format.');
  }

  const dueDate = new Date(
    new Date().getFullYear(),
    Number(match.groups.month) - 1,
    Number(match.groups.day),
    Number(match.groups.hour),
    Number(match.groups.minute),
  );

  return dueDate.toISOString();
}

async function getRobloxIDfromDiscordId(id: string | null) {
  if (!id) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.blox.link/v4/public/guilds/1249831162478596260/discord-to-roblox/${id}`,
      {
        headers: {
          Authorization: getRequiredEnv('BLOXLINK_API_KEY'),
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Bloxlink returned ${response.status}.`);
    }

    const data: unknown = await response.json();

    if (
      typeof data === 'object' &&
      data !== null &&
      'robloxID' in data &&
      (typeof data.robloxID === 'string' || typeof data.robloxID === 'number')
    ) {
      return String(data.robloxID);
    }

    return null;
  } catch (error) {
    console.error("Error fetching Roblox ID:", error);
    return null;
  }
}

async function getUsernameFromRobloxId(id: string | null) {
  if (!id) {
    return null;
  }

  try {
    const response = await fetch(`https://users.roblox.com/v1/users/${id}`);

    if (!response.ok) {
      throw new Error(`Roblox returned ${response.status}.`);
    }

    const data: unknown = await response.json();

    if (
      typeof data === 'object' &&
      data !== null &&
      'name' in data &&
      typeof data.name === 'string'
    ) {
      return data.name;
    }

    return null;
  } catch (error) {
    console.error("Error fetching username:", error);
    return null;
  }
}

async function getUsernameFromDiscordId(id: string | null) {
  const robloxId = await getRobloxIDfromDiscordId(id);

  return getUsernameFromRobloxId(robloxId);
}

function formatShiftMember(username: string | null, discordId: string | null) {
  if (username) {
    return username;
  }

  if (discordId) {
    return `<@${discordId}>`;
  }

  return 'None';
}

export async function sendToShiftTrello(
  shiftTime: string,
  hostId: string,
  cohostId: string | null,
  promotional: boolean,
) {
  const [hostUsername, cohostUsername] = await Promise.all([
    getUsernameFromDiscordId(hostId),
    getUsernameFromDiscordId(cohostId),
  ]);

  const trello = createTrelloClient({
    apiKey: getRequiredEnv('TRELLO_API_KEY'),
    apiToken: getRequiredEnv('TRELLO_TOKEN'),
  });

  const [lists, labels] = await Promise.all([
    trello.boards.getBoardLists({
      id: board,
      filter: 'open',
      fields: ['id', 'name', 'pos'],
    }),
    trello.boards.getBoardLabels({ id: board }),
  ]);

  const targetList = lists[TARGET_LIST_INDEX];

  if (!targetList) {
    throw new Error('The Trello board does not have a second list.');
  }

  const plannedLabel =
    labels.find(
      (label) =>
        label.name === PLANNED_LABEL_NAME &&
        label.color === PLANNED_LABEL_COLOR,
    ) ??
    (await trello.boards.createBoardLabel({
      id: board,
      name: PLANNED_LABEL_NAME,
      color: PLANNED_LABEL_COLOR,
    }));

  return trello.cards.createCard({
    idList: targetList.id,
    name: promotional ? 'Promotional Shift' : 'Shift',
    desc:
      `Host: ${formatShiftMember(hostUsername, hostId)}\n` +
      `Co-Host: ${formatShiftMember(cohostUsername, cohostId)}`,
    due: parseShiftDueDate(shiftTime),
    idLabels: [plannedLabel.id],
  });
}

import { createTrelloClient } from 'trello.js';
import { saveShiftRecord } from './shiftStore';
import { parseShiftWindow } from '../utils/shiftTime';

export const SHIFT_BOARD_ID = '6a3f3f551c2e98987fecad69';
export const SHIFT_TARGET_LIST_INDEX = 0;

const PLANNED_LABEL_NAME = 'Planned';
const PLANNED_LABEL_COLOR = 'yellow';

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required to create a Trello shift card.`);
  }

  return value;
}

function parseShiftDueDate(shiftTime: string) {
  const window = parseShiftWindow(shiftTime);

  if (!window) {
    throw new Error('Shift time must be in DD-MM HH:mm-HH:mm format.');
  }

  return new Date(window.startMs).toISOString();
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
    console.error('Error fetching Roblox ID:', error);
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
    console.error('Error fetching username:', error);
    return null;
  }
}

async function getRobloxIdFromUsername(username: string | null) {
  if (!username) {
    return null;
  }

  try {
    const response = await fetch(
      'https://users.roblox.com/v1/usernames/users',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: false,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Roblox returned ${response.status}.`);
    }

    const data: unknown = await response.json();

    if (
      typeof data === 'object' &&
      data !== null &&
      'data' in data &&
      Array.isArray(data.data)
    ) {
      const [user] = data.data;

      if (
        typeof user === 'object' &&
        user !== null &&
        'id' in user &&
        (typeof user.id === 'string' || typeof user.id === 'number')
      ) {
        return String(user.id);
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching Roblox ID from username:', error);
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

async function getDiscordIdFromRobloxUsername(username: string) {
  const robloxId = await getRobloxIdFromUsername(username);

  if (!robloxId) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.blox.link/v4/public/guilds/1249831162478596260/roblox-to-discord/${robloxId}`,
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
      'discordIDs' in data &&
      Array.isArray(data.discordIDs) &&
      data.discordIDs.length > 0 &&
      (typeof data.discordIDs[0] === 'string' ||
        typeof data.discordIDs[0] === 'number')
    ) {
      return String(data.discordIDs[0]);
    }

    return null;
  } catch (error) {
    console.error('Error fetching Discord ID:', error);
    return null;
  }
}

export async function sendToShiftTrello(
  shiftTime: string,
  hostId: string,
  cohostId: string | null,
  promotional: boolean,
  approverId: string,
) {
  const [hostUsername, cohostUsername] = await Promise.all([
    getUsernameFromDiscordId(hostId),
    getUsernameFromDiscordId(cohostId),
  ]);
  const window = parseShiftWindow(shiftTime);

  if (!window) {
    throw new Error('Shift time must be in DD-MM HH:mm-HH:mm format.');
  }

  const trello = createTrelloClient({
    apiKey: getRequiredEnv('TRELLO_API_KEY'),
    apiToken: getRequiredEnv('TRELLO_TOKEN'),
  });

  const [lists, labels] = await Promise.all([
    trello.boards.getBoardLists({
      id: SHIFT_BOARD_ID,
      filter: 'open',
      fields: ['id', 'name', 'pos'],
    }),
    trello.boards.getBoardLabels({ id: SHIFT_BOARD_ID }),
  ]);

  const targetList = lists[SHIFT_TARGET_LIST_INDEX];

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
      id: SHIFT_BOARD_ID,
      name: PLANNED_LABEL_NAME,
      color: PLANNED_LABEL_COLOR,
    }));

  const card = await trello.cards.createCard({
    idList: targetList.id,
    name: promotional ? 'Promotional Shift' : 'Shift',
    desc:
      `Host: ${hostUsername ?? 'Unknown'}\n` +
      `Co-Host: ${cohostUsername ?? 'None'}`,
    due: parseShiftDueDate(shiftTime),
    idLabels: [plannedLabel.id],
  });

  try {
    saveShiftRecord({
      shiftTime,
      trelloCardId: card.id,
      hostDiscordId: hostId,
      hostUsername: hostUsername ?? 'Unknown',
      cohostDiscordId: cohostId,
      cohostUsername,
      approverDiscordId: approverId,
      promotional,
      startMs: window.startMs,
      endMs: window.endMs,
    });
  } catch (error) {
    await trello.cards.deleteCard({ id: card.id }).catch(() => {});
    throw error;
  }

  return card;
}

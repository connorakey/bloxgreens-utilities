import type { Client } from 'discord.js';
import { createTrelloClient } from 'trello.js';
import { SHIFT_BOARD_ID, SHIFT_TARGET_LIST_INDEX } from './shiftTrelloService';
import {
  clearShiftTimers,
  getShiftByCardId,
  getShiftByShiftTime,
  markShiftConcluded,
  markShiftDeleted,
  markShiftStarted,
} from './shiftStore';

type TrackedShiftCard = {
  id: string;
  name: string;
  due: string | null;
  url: string | null;
  idList: string | null;
  idLabels?: Array<
    | string
    | {
        id: string;
        name?: string | null;
        color?: string | null;
      }
  >;
};

type LabelSpec = {
  name: string;
  color: string;
};

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const SHIFT_NOTICE_WINDOW_MS = 5 * 60 * 1000;
const SHIFT_DELETE_AFTER_END_MS = 12 * 60 * 60 * 1000;

const STARTING_SOON_LABEL: LabelSpec = { name: 'Starting Soon', color: 'blue' };
const IN_SESSION_LABEL: LabelSpec = { name: 'In Session', color: 'green' };
const DELAYED_LABEL: LabelSpec = { name: 'Delayed', color: 'red' };
const CANCELLED_LABEL: LabelSpec = { name: 'Cancelled', color: 'red' };
const CONCLUDED_LABEL: LabelSpec = { name: 'Concluded', color: 'orange' };

let discordClient: Client | null = null;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;
const labelIdsByBoard = new Map<string, Map<string, string>>();

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required to monitor Trello shift cards.`);
  }

  return value;
}

function isTrackedShiftCard(value: unknown): value is TrackedShiftCard {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'due' in value &&
    (value.due === null || typeof value.due === 'string') &&
    'desc' in value &&
    (value.desc === null || typeof value.desc === 'string') &&
    'url' in value &&
    (value.url === null || typeof value.url === 'string') &&
    'idList' in value &&
    (value.idList === null || typeof value.idList === 'string')
  );
}

function hasLabel(
  card: TrackedShiftCard,
  label: LabelSpec,
  labelIdsByKey: Map<string, string>,
) {
  const key = `${label.name}:${label.color}`;
  const labelId = labelIdsByKey.get(key);

  return (
    card.idLabels?.some((existingLabel) => {
      if (typeof existingLabel === 'string') {
        return labelId ? existingLabel === labelId : false;
      }

      return (
        existingLabel.id === labelId ||
        (existingLabel.name === label.name &&
          existingLabel.color === label.color)
      );
    }) ?? false
  );
}

function isCardDue(card: TrackedShiftCard) {
  if (!card.due) {
    return false;
  }

  const dueMs = Date.parse(card.due);

  return Number.isFinite(dueMs) && dueMs <= Date.now();
}

function isWithinFiveMinutes(card: TrackedShiftCard) {
  if (!card.due) {
    return false;
  }

  const dueMs = Date.parse(card.due);

  return (
    Number.isFinite(dueMs) &&
    Date.now() >= dueMs - SHIFT_NOTICE_WINDOW_MS &&
    Date.now() < dueMs
  );
}

async function sendDirectMessage(userId: string, content: string) {
  if (!discordClient) {
    throw new Error('Discord client is not registered with the shift monitor.');
  }

  const user = await discordClient.users.fetch(userId);

  await user.send(content);
}

async function fetchTargetListCards() {
  const trello = createTrelloClient({
    apiKey: getRequiredEnv('TRELLO_API_KEY'),
    apiToken: getRequiredEnv('TRELLO_TOKEN'),
  });

  const lists = await trello.boards.getBoardLists({
    id: SHIFT_BOARD_ID,
    filter: 'open',
    fields: ['id', 'name', 'pos'],
  });

  const targetList = lists[SHIFT_TARGET_LIST_INDEX];

  if (!targetList) {
    throw new Error(
      'The Trello board does not have a list at the target index.',
    );
  }

  const response = await fetch(
    `https://api.trello.com/1/lists/${targetList.id}/cards?fields=id,name,due,desc,url,idList,idLabels&key=${encodeURIComponent(getRequiredEnv('TRELLO_API_KEY'))}&token=${encodeURIComponent(getRequiredEnv('TRELLO_TOKEN'))}`,
  );

  if (!response.ok) {
    throw new Error(`Trello returned ${response.status}.`);
  }

  const data: unknown = await response.json();

  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(isTrackedShiftCard);
}

async function clearAllLabels(
  trello: ReturnType<typeof createTrelloClient>,
  card: TrackedShiftCard,
) {
  if (!card.idLabels?.length) {
    return;
  }

  await Promise.all(
    card.idLabels.map((label) =>
      trello.cards.removeCardLabel({
        id: card.id,
        idLabel: typeof label === 'string' ? label : label.id,
      }),
    ),
  );
}

async function getLabelId(
  trello: ReturnType<typeof createTrelloClient>,
  boardId: string,
  label: LabelSpec,
) {
  const cachedBoardLabels =
    labelIdsByBoard.get(boardId) ?? new Map<string, string>();
  const key = `${label.name}:${label.color}`;

  const cachedLabelId = cachedBoardLabels.get(key);

  if (cachedLabelId) {
    return cachedLabelId;
  }

  const labels = await trello.boards.getBoardLabels({ id: boardId });
  const existingLabel = labels.find(
    (existing) =>
      existing.name === label.name && existing.color === label.color,
  );

  if (existingLabel) {
    cachedBoardLabels.set(key, existingLabel.id);
    labelIdsByBoard.set(boardId, cachedBoardLabels);
    return existingLabel.id;
  }

  const createdLabel = await trello.boards.createBoardLabel({
    id: boardId,
    name: label.name,
    color: label.color,
  });

  cachedBoardLabels.set(key, createdLabel.id);
  labelIdsByBoard.set(boardId, cachedBoardLabels);
  return createdLabel.id;
}

async function setCardStatusLabel(
  trello: ReturnType<typeof createTrelloClient>,
  card: TrackedShiftCard,
  label: LabelSpec,
) {
  await clearAllLabels(trello, card);

  const labelId = await getLabelId(trello, SHIFT_BOARD_ID, label);

  await trello.cards.addCardLabel({
    id: card.id,
    value: labelId,
  });
}

async function deleteShiftCard(
  trello: ReturnType<typeof createTrelloClient>,
  card: TrackedShiftCard,
) {
  await trello.cards.deleteCard({ id: card.id });
}

async function handleShiftCard(
  trello: ReturnType<typeof createTrelloClient>,
  card: TrackedShiftCard,
  labelIdsByKey: Map<string, string>,
) {
  const shift = getShiftByCardId(card.id);

  if (!shift) {
    return;
  }

  const now = Date.now();
  const hasStarted = hasLabel(card, IN_SESSION_LABEL, labelIdsByKey);
  const hasDelayed = hasLabel(card, DELAYED_LABEL, labelIdsByKey);
  const hasConcluded = hasLabel(card, CONCLUDED_LABEL, labelIdsByKey);
  const hasStartingSoon = hasLabel(card, STARTING_SOON_LABEL, labelIdsByKey);

  if (now >= shift.endMs + SHIFT_DELETE_AFTER_END_MS) {
    await deleteShiftCard(trello, card);
    markShiftDeleted(shift.shiftTime);
    return;
  }

  if (now >= shift.endMs) {
    if (!hasConcluded) {
      await setCardStatusLabel(trello, card, CONCLUDED_LABEL);
      markShiftConcluded(shift.shiftTime);
    }

    return;
  }

  if (
    now >= shift.startMs - SHIFT_NOTICE_WINDOW_MS &&
    now < shift.startMs &&
    !hasStarted &&
    !hasDelayed &&
    !hasStartingSoon
  ) {
    await setCardStatusLabel(trello, card, STARTING_SOON_LABEL);

    const preStartMessage = `Your ${shift.shiftTime} shift is 5 minutes away from being due, please run /shift start as soon as possible`;
    const messages = [sendDirectMessage(shift.hostDiscordId, preStartMessage)];

    if (shift.cohostDiscordId) {
      messages.push(sendDirectMessage(shift.cohostDiscordId, preStartMessage));
    }

    await Promise.allSettled(messages);
    return;
  }

  if (isCardDue(card) && !hasStarted && !hasDelayed) {
    await setCardStatusLabel(trello, card, DELAYED_LABEL);

    const dueMessage = `Your ${shift.shiftTime} shift is due to start, please run /shift start as soon as possible, failure to do so will result in concequences`;
    const messages = [sendDirectMessage(shift.hostDiscordId, dueMessage)];

    if (shift.cohostDiscordId) {
      messages.push(sendDirectMessage(shift.cohostDiscordId, dueMessage));
    }

    if (shift.approverDiscordId) {
      messages.push(
        sendDirectMessage(
          shift.approverDiscordId,
          `Your ${shift.shiftTime} shift that you approved is due, and the host <@${shift.hostDiscordId}> has not shown up for their shift`,
        ),
      );
    }

    await Promise.allSettled(messages);
  }
}

async function pollShiftCards() {
  if (isPolling) {
    return;
  }

  isPolling = true;

  try {
    const trello = createTrelloClient({
      apiKey: getRequiredEnv('TRELLO_API_KEY'),
      apiToken: getRequiredEnv('TRELLO_TOKEN'),
    });

    const boardLabels = await trello.boards.getBoardLabels({
      id: SHIFT_BOARD_ID,
    });
    const labelIdsByKey = new Map(
      boardLabels.map((label) => [
        `${label.name ?? ''}:${label.color ?? ''}`,
        label.id,
      ]),
    );
    const cards = await fetchTargetListCards();

    for (const card of cards) {
      await handleShiftCard(trello, card, labelIdsByKey);
    }
  } catch (error) {
    console.error('Shift due monitor failed:', error);
  } finally {
    isPolling = false;
  }
}

export async function markShiftStartedByShiftTime(shiftTime: string) {
  const shift = getShiftByShiftTime(shiftTime);

  if (!shift) {
    return false;
  }

  const cards = await fetchTargetListCards();
  const matchingCard = cards.find((card) => card.id === shift.trelloCardId);

  if (!matchingCard) {
    return false;
  }

  const trello = createTrelloClient({
    apiKey: getRequiredEnv('TRELLO_API_KEY'),
    apiToken: getRequiredEnv('TRELLO_TOKEN'),
  });

  await setCardStatusLabel(trello, matchingCard, IN_SESSION_LABEL);
  markShiftStarted(shiftTime);
  return true;
}

export async function cancelShiftByShiftTime(
  shiftTime: string,
  deleteNow: boolean,
) {
  const shift = getShiftByShiftTime(shiftTime);

  if (!shift) {
    return false;
  }

  const cards = await fetchTargetListCards();
  const matchingCard = cards.find((card) => card.id === shift.trelloCardId);

  if (!matchingCard) {
    return false;
  }

  const trello = createTrelloClient({
    apiKey: getRequiredEnv('TRELLO_API_KEY'),
    apiToken: getRequiredEnv('TRELLO_TOKEN'),
  });

  if (deleteNow) {
    await trello.cards.deleteCard({ id: matchingCard.id });
    markShiftDeleted(shiftTime);
    return true;
  }

  clearShiftTimers(shiftTime);
  markShiftConcluded(shiftTime);
  await setCardStatusLabel(trello, matchingCard, CANCELLED_LABEL);
  return true;
}

export async function startShiftDueMonitor(
  client: Client,
  options?: {
    pollIntervalMs?: number;
    runImmediately?: boolean;
  },
) {
  if (monitorTimer) {
    return;
  }

  discordClient = client;

  if (options?.runImmediately ?? true) {
    await pollShiftCards();
  }

  monitorTimer = setInterval(() => {
    void pollShiftCards();
  }, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
}

export function stopShiftDueMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Database } from 'bun:sqlite';

const DB_PATH = resolve(process.cwd(), 'data', 'shifts.sqlite');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS shifts (
    shift_time TEXT PRIMARY KEY,
    trello_card_id TEXT NOT NULL UNIQUE,
    host_discord_id TEXT NOT NULL,
    host_username TEXT NOT NULL,
    cohost_discord_id TEXT,
    cohost_username TEXT,
    approver_discord_id TEXT,
    promotional INTEGER NOT NULL DEFAULT 0,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    started_at INTEGER,
    concluded_at INTEGER,
    deleted_at INTEGER
  );
`);

type ShiftRecord = {
  shiftTime: string;
  trelloCardId: string;
  hostDiscordId: string;
  hostUsername: string;
  cohostDiscordId: string | null;
  cohostUsername: string | null;
  approverDiscordId: string | null;
  promotional: boolean;
  startMs: number;
  endMs: number;
  startedAt: number | null;
  concludedAt: number | null;
  deletedAt: number | null;
};

type ShiftInsert = {
  shiftTime: string;
  trelloCardId: string;
  hostDiscordId: string;
  hostUsername: string;
  cohostDiscordId: string | null;
  cohostUsername: string | null;
  approverDiscordId: string | null;
  promotional: boolean;
  startMs: number;
  endMs: number;
};

function rowToShiftRecord(row: Record<string, unknown>): ShiftRecord {
  return {
    shiftTime: String(row.shift_time),
    trelloCardId: String(row.trello_card_id),
    hostDiscordId: String(row.host_discord_id),
    hostUsername: String(row.host_username),
    cohostDiscordId:
      row.cohost_discord_id === null || row.cohost_discord_id === undefined
        ? null
        : String(row.cohost_discord_id),
    cohostUsername:
      row.cohost_username === null || row.cohost_username === undefined
        ? null
        : String(row.cohost_username),
    approverDiscordId:
      row.approver_discord_id === null || row.approver_discord_id === undefined
        ? null
        : String(row.approver_discord_id),
    promotional: Number(row.promotional) === 1,
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    startedAt:
      row.started_at === null || row.started_at === undefined
        ? null
        : Number(row.started_at),
    concludedAt:
      row.concluded_at === null || row.concluded_at === undefined
        ? null
        : Number(row.concluded_at),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : Number(row.deleted_at),
  };
}

export function saveShiftRecord(record: ShiftInsert) {
  db.query(
    `
      INSERT INTO shifts (
        shift_time,
        trello_card_id,
        host_discord_id,
        host_username,
        cohost_discord_id,
        cohost_username,
        approver_discord_id,
        promotional,
        start_ms,
        end_ms
      ) VALUES (
        $shiftTime,
        $trelloCardId,
        $hostDiscordId,
        $hostUsername,
        $cohostDiscordId,
        $cohostUsername,
        $approverDiscordId,
        $promotional,
        $startMs,
        $endMs
      )
      ON CONFLICT(shift_time) DO UPDATE SET
        trello_card_id = excluded.trello_card_id,
        host_discord_id = excluded.host_discord_id,
        host_username = excluded.host_username,
        cohost_discord_id = excluded.cohost_discord_id,
        cohost_username = excluded.cohost_username,
        approver_discord_id = excluded.approver_discord_id,
        promotional = excluded.promotional,
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms
    `,
  ).run({
    $shiftTime: record.shiftTime,
    $trelloCardId: record.trelloCardId,
    $hostDiscordId: record.hostDiscordId,
    $hostUsername: record.hostUsername,
    $cohostDiscordId: record.cohostDiscordId,
    $cohostUsername: record.cohostUsername,
    $approverDiscordId: record.approverDiscordId,
    $promotional: record.promotional ? 1 : 0,
    $startMs: record.startMs,
    $endMs: record.endMs,
  });
}

export function getShiftByShiftTime(shiftTime: string) {
  const row = db
    .query('SELECT * FROM shifts WHERE shift_time = ? LIMIT 1')
    .get(shiftTime) as Record<string, unknown> | null;

  return row ? rowToShiftRecord(row) : null;
}

export function getShiftByCardId(trelloCardId: string) {
  const row = db
    .query('SELECT * FROM shifts WHERE trello_card_id = ? LIMIT 1')
    .get(trelloCardId) as Record<string, unknown> | null;

  return row ? rowToShiftRecord(row) : null;
}

export function listActiveShifts() {
  const rows = db
    .query(
      `
        SELECT *
        FROM shifts
        WHERE deleted_at IS NULL
          AND concluded_at IS NULL
        ORDER BY start_ms ASC
      `,
    )
    .all() as Record<string, unknown>[];

  return rows.map(rowToShiftRecord);
}

export function markShiftStarted(shiftTime: string) {
  db.query(
    'UPDATE shifts SET started_at = COALESCE(started_at, $startedAt) WHERE shift_time = $shiftTime',
  ).run({
    $shiftTime: shiftTime,
    $startedAt: Date.now(),
  });
}

export function markShiftConcluded(shiftTime: string) {
  db.query(
    'UPDATE shifts SET concluded_at = COALESCE(concluded_at, $concludedAt) WHERE shift_time = $shiftTime',
  ).run({
    $shiftTime: shiftTime,
    $concludedAt: Date.now(),
  });
}

export function markShiftDeleted(shiftTime: string) {
  db.query(
    'UPDATE shifts SET deleted_at = COALESCE(deleted_at, $deletedAt) WHERE shift_time = $shiftTime',
  ).run({
    $shiftTime: shiftTime,
    $deletedAt: Date.now(),
  });
}

export function clearShiftTimers(shiftTime: string) {
  db.query(
    `
      UPDATE shifts
      SET started_at = NULL,
          concluded_at = NULL,
          deleted_at = NULL
      WHERE shift_time = $shiftTime
    `,
  ).run({
    $shiftTime: shiftTime,
  });
}

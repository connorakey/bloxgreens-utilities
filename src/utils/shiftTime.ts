export const SHIFT_TIME_ZONE = 'America/New_York';

export const SHIFT_TIME_FORMAT =
  /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2]) ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const values: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    ) - date.getTime()
  );
}

function zonedDateTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utcMs = naiveUtcMs;

  for (let i = 0; i < 3; i += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = naiveUtcMs - offsetMs;

    if (nextUtcMs === utcMs) {
      break;
    }

    utcMs = nextUtcMs;
  }

  return utcMs;
}

export function parseShiftWindow(shiftTime: string) {
  const match = shiftTime.match(
    /^(?<day>0[1-9]|[12]\d|3[01])-(?<month>0[1-9]|1[0-2]) (?<startHour>[01]\d|2[0-3]):(?<startMinute>[0-5]\d)-(?<endHour>[01]\d|2[0-3]):(?<endMinute>[0-5]\d)$/,
  );

  if (!match?.groups) {
    return null;
  }

  const start = new Date(
    zonedDateTimeToUtcMs(
      new Date().getFullYear(),
      Number(match.groups.month),
      Number(match.groups.day),
      Number(match.groups.startHour),
      Number(match.groups.startMinute),
      SHIFT_TIME_ZONE,
    ),
  );

  const end = new Date(
    zonedDateTimeToUtcMs(
      new Date().getFullYear(),
      Number(match.groups.month),
      Number(match.groups.day),
      Number(match.groups.endHour),
      Number(match.groups.endMinute),
      SHIFT_TIME_ZONE,
    ),
  );

  if (end.getTime() < start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export function formatShiftTimeWithTimestamp(shiftTime: string) {
  const window = parseShiftWindow(shiftTime);

  if (!window) {
    return shiftTime;
  }

  return `${shiftTime} <t:${Math.floor(window.startMs / 1000)}:f>`;
}

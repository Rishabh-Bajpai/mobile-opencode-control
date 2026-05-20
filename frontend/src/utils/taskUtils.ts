export function taskStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "success" || normalized === "completed") {
    return "success";
  }
  if (normalized === "running") {
    return "running";
  }
  if (normalized === "failed" || normalized === "error") {
    return "error";
  }
  return "idle";
}

export function toLocalDateInputParts(value: string | null): { date: string; time: string } {
  if (!value) {
    return { date: "", time: "" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "", time: "" };
  }

  const pad = (input: number) => String(input).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function toLocalDateTimeInputValue(value: string | null) {
  const parts = toLocalDateInputParts(value);
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
}

export function toIsoFromLocalDateAndTime(date: string, time: string) {
  if (!date) {
    return null;
  }

  const localDateTime = new Date(`${date}T${time || "00:00"}`);
  if (Number.isNaN(localDateTime.getTime())) {
    return null;
  }

  return localDateTime.toISOString();
}

/**
 * Extracts a string part from `Intl.DateTimeFormat.formatToParts()` output.
 * Returns the empty string when the part is not present.
 */
export function getIntlPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/**
 * Like `getIntlPart` but parses the result as a base-10 integer.
 * Returns 0 when the part is missing.
 */
export function getIntlPartInt(parts: Intl.DateTimeFormatPart[], type: string): number {
  return parseInt(getIntlPart(parts, type) || "0", 10);
}

/**
 * Converts a date + time string (as entered by the user) into an ISO UTC string,
 * interpreting the wall-clock time as being in `timezone` rather than the browser's
 * local timezone.
 *
 * @param dateStr - Date in "YYYY-MM-DD" format.
 * @param timeStr - Time in "HH:mm" format (as produced by `<input type="time">`).
 * @param timezone - IANA timezone identifier (e.g. "America/New_York").
 */
export function toIsoInTimezone(dateStr: string, timeStr: string, timezone: string): string | null {
  if (!dateStr) return null;
  // Append seconds to satisfy the ISO 8601 full-time requirement used below.
  const timeString = (timeStr || "00:00") + ":00";
  try {
    // Treat the input as UTC to get a starting reference point.
    const asUtc = new Date(`${dateStr}T${timeString}Z`);
    if (Number.isNaN(asUtc.getTime())) return null;

    // Determine what wall-clock time `timezone` shows at `asUtc`.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(asUtc);
    let tzHour = getIntlPartInt(parts, "hour");
    // Intl.DateTimeFormat with hour12:false can return 24 instead of 0 at midnight.
    if (tzHour === 24) tzHour = 0;

    // Re-express that wall-clock reading as a UTC timestamp.
    const tzWallAsUtc = new Date(
      Date.UTC(
        getIntlPartInt(parts, "year"),
        getIntlPartInt(parts, "month") - 1,
        getIntlPartInt(parts, "day"),
        tzHour,
        getIntlPartInt(parts, "minute"),
        getIntlPartInt(parts, "second"),
      ),
    );

    // The timezone's offset at this instant, then shift to get the true UTC time.
    const offsetMs = asUtc.getTime() - tzWallAsUtc.getTime();
    return new Date(asUtc.getTime() + offsetMs).toISOString();
  } catch {
    return null;
  }
}

/**
 * Formats a UTC ISO string as separate date ("YYYY-MM-DD") and time ("HH:mm") parts
 * expressed in the given IANA `timezone`.
 */
export function toDateInputPartsInTimezone(value: string | null, timezone: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    let hour = getIntlPart(parts, "hour");
    // Intl.DateTimeFormat with hour12:false can return "24" instead of "00" at midnight.
    if (hour === "24") hour = "00";
    const year = getIntlPart(parts, "year");
    if (!year) return { date: "", time: "" };
    return {
      date: `${year}-${getIntlPart(parts, "month")}-${getIntlPart(parts, "day")}`,
      time: `${hour}:${getIntlPart(parts, "minute")}`,
    };
  } catch {
    return { date: "", time: "" };
  }
}

/** Returns a `datetime-local` input value ("YYYY-MM-DDTHH:mm") in the given timezone. */
export function toDateTimeInputValueInTimezone(value: string | null, timezone: string): string {
  const parts = toDateInputPartsInTimezone(value, timezone);
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
}

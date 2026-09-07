const HOUR = 3_600_000;
const MIN_INTERVAL = 6 * HOUR;
const TIME_ZONE = 'Europe/Bucharest';
const HOURS = [8, 14, 20];
const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });

function inSyncWindow(date) {
    return HOURS.includes(Number(formatter.format(date)));
}

// A one-hour window accommodates cold starts and delayed scheduler calls.
// Enforce six elapsed hours too: a late morning request must not cause an
// early afternoon call to violate a rolling bank quota.
function nextSyncTime(attemptAt) {
    const earliest = new Date(new Date(attemptAt).getTime() + MIN_INTERVAL);
    if (inSyncWindow(earliest)) return earliest;
    let timestamp = Math.ceil(earliest.getTime() / HOUR) * HOUR;
    for (let hour = 0; hour < 48; hour++, timestamp += HOUR) {
        const candidate = new Date(timestamp);
        if (inSyncWindow(candidate)) return candidate;
    }
    throw new Error('No banking schedule window found');
}

module.exports = { TIME_ZONE, HOURS, MIN_INTERVAL, inSyncWindow, nextSyncTime };

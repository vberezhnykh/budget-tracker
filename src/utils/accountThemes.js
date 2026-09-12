const ACCOUNT_THEMES = ['teal', 'violet', 'amber', 'blue', 'rose', 'cyan', 'olive', 'orange', 'pink', 'slate'];

function hashId(id) {
  let hash = 2166136261;
  for (const character of id) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

// Assign by identity, never carousel position or account name. Sorting before
// resolving palette collisions keeps colors unchanged after drag-and-drop,
// renaming, balance updates, and moving an account outside the total capital.
export function getAccountThemes(accounts) {
  const ids = [...new Set(accounts.map(account => String(account._id)))].sort();
  const themes = new Map();
  const usage = Array(ACCOUNT_THEMES.length).fill(0);

  for (const id of ids) {
    const preferred = hashId(id) % ACCOUNT_THEMES.length;
    const lowestUsage = Math.min(...usage);
    let index = preferred;
    while (usage[index] > lowestUsage) index = (index + 1) % ACCOUNT_THEMES.length;
    usage[index] += 1;
    themes.set(id, ACCOUNT_THEMES[index]);
  }

  return themes;
}

import { pluralForm } from './plural';

// Чистка старых описаний: чистая логика экрана «Старые описания». Здесь нет
// ни запросов, ни React: как разложить предложения сервера по разделам,
// что выбрано, сколько операций заденет применение и что написать в строке
// «Ещё». Ответ сервера - см. server/descriptionCleanupRouter.js.

// Срок отмены после применения; совпадает с undoDays на сервере.
export const UNDO_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const FORMS = {
    nominative: ['операция', 'операции', 'операций'],
    genitive: ['операции', 'операций', 'операций'],
    accusative: ['операцию', 'операции', 'операций'],
    dative: ['операции', 'операциям', 'операциям'],
};

// «1 операция», «5 операций». Падеж нужен фразам вроде «Изменить 5 операций?»,
// «Применить к 5 операциям» и «У 5 операций».
export const operationsLabel = (count, grammaticalCase = 'nominative') =>
    `${count} ${pluralForm(count, FORMS[grammaticalCase])}`;

export const companiesLabel = (count) =>
    `${count} ${pluralForm(count, ['компания', 'компании', 'компаний'])}`;

// --- Разделы проверки -----------------------------------------------------------------

const COMPANY_KINDS = ['existing', 'new'];

// Предложения сервера -> { companies, notes, skipped }.
//   companies - по одному блоку на целевую компанию (existing и new), в порядке
//               ответа; в блоке тексты-источники;
//   notes     - тексты, которые останутся описанием (kind note);
//   skipped   - без ответа Claude (kind skip) и всё непонятное; не выбираются.
// У каждого блока: { id, name, isNew, count, keys, items }.
export function groupProposals(proposals) {
    const companies = [];
    const byName = new Map();
    const notes = [];
    const skipped = [];
    for (const proposal of Array.isArray(proposals) ? proposals : []) {
        if (proposal.kind === 'note') {
            notes.push(proposal);
        } else if (COMPANY_KINDS.includes(proposal.kind) && typeof proposal.company === 'string' && proposal.company.trim()) {
            const name = proposal.company.trim();
            const id = name.toLowerCase();
            let group = byName.get(id);
            if (!group) {
                group = { id, name, isNew: true, count: 0, keys: [], items: [] };
                byName.set(id, group);
                companies.push(group);
            }
            group.items.push(proposal);
            group.keys.push(proposal.key);
            group.count += proposal.count || 0;
            if (proposal.kind !== 'new') group.isNew = false;
        } else {
            skipped.push(proposal);
        }
    }
    return { companies, notes, skipped };
}

// Все ключи, которые можно выбрать: тексты компаний и заметки.
export function selectableKeys(review) {
    return [
        ...review.companies.flatMap(group => group.keys),
        ...review.notes.map(proposal => proposal.key),
    ];
}

// --- Выбор -----------------------------------------------------------------------------

// Выбрано всё, что можно выбрать.
export const selectAll = (review) => new Set(selectableKeys(review));

export function toggleKey(selected, key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
}

// 'all' | 'some' | 'none' для набора ключей (блок компании или раздел заметок).
export function selectionState(selected, keys) {
    const chosen = keys.filter(key => selected.has(key)).length;
    if (chosen === 0) return 'none';
    return chosen === keys.length ? 'all' : 'some';
}

// Нажатие на общий флажок: выбрано всё - снять всё, иначе (ничего или часть) - выбрать всё.
export function toggleKeys(selected, keys) {
    const next = new Set(selected);
    if (selectionState(selected, keys) === 'all') keys.forEach(key => next.delete(key));
    else keys.forEach(key => next.add(key));
    return next;
}

function countsByKey(review) {
    const counts = new Map();
    for (const group of review.companies) for (const item of group.items) counts.set(item.key, item.count || 0);
    for (const proposal of review.notes) counts.set(proposal.key, proposal.count || 0);
    return counts;
}

// Сколько операций заденет применение выбранного.
export function selectedOperations(selected, review) {
    let total = 0;
    for (const [key, count] of countsByKey(review)) if (selected.has(key)) total += count;
    return total;
}

// Ключи для POST /apply: только выбранные и только те, что есть в предложениях, в порядке ответа.
export function keysToSend(selected, review) {
    return selectableKeys(review).filter(key => selected.has(key));
}

// --- Состояние прогона --------------------------------------------------------------------

// Чистка, которую еще можно отменить: поле undo ответа сервера ({ runId, appliedAt,
// undoUntil, stats }) или null. Оно не зависит от последнего прогона, поэтому новый
// разбор отмену не прячет. undoUntil сверяется и с часами клиента: сервер убирает undo
// только при следующем чтении.
export function activeUndo(summary, now = new Date()) {
    const undo = summary?.undo;
    if (!undo || !undo.undoUntil) return null;
    return new Date(undo.undoUntil).getTime() > now.getTime() ? undo : null;
}

// «14 ноября»; с годом, если он не текущий.
export function formatCleanupDate(value, now = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const options = date.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'long' }
        : { day: 'numeric', month: 'long', year: 'numeric' };
    return date.toLocaleDateString('ru-RU', options);
}

// Дата, до которой можно будет отменить чистку, если применить сегодня.
export const undoDeadline = (now = new Date()) => new Date(now.getTime() + UNDO_DAYS * DAY_MS);

// Что написать под строкой «Старые описания» в «Ещё», или null, если строки быть не должно.
// summary - ответ GET /api/description-cleanup. Сначала то, что требует внимания
// (идёт разбор, список ждёт проверки, можно отменить), потом число операций без компании.
export function cleanupRowSubtitle(summary, now = new Date()) {
    if (!summary || typeof summary !== 'object') return null;
    const run = summary.run;
    if (run?.status === 'submitted') return 'Claude разбирает описания';
    if (run?.status === 'ready') return 'Готово к просмотру';
    const undo = activeUndo(summary, now);
    if (undo) return `Можно отменить до ${formatCleanupDate(undo.undoUntil, now)}`;
    const legacy = Number(summary.legacyCount) || 0;
    if (legacy > 0) return `${operationsLabel(legacy)} без компании`;
    return null;
}

const Company = require('./models/Company');

const present = (value, key) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
const invalidCompany = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_COMPANY' });

// A transaction owns historical snapshots. Read the registry only when the
// user assigns a different company; ordinary edits must never refresh history.
async function prepareTransactionCompany(body, current = null, { session } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const prepared = { ...body };
    const type = body.type ?? current?.type;
    if (type !== undefined && type !== 'expense') {
        delete prepared.companyId;
        delete prepared.companyName;
        return prepared;
    }
    if (present(body, 'companyName') && (typeof body.companyName !== 'string' || body.companyName.trim().length > 120)) {
        throw invalidCompany('Название компании должно быть строкой длиной до 120 символов');
    }
    if (!present(body, 'companyId')) {
        if (current?.companyId && present(body, 'companyName') && body.companyName.trim() !== '') {
            if (typeof current.companyName === 'string') prepared.companyName = current.companyName;
            else delete prepared.companyName;
        }
        return prepared;
    }
    if (body.companyId === null || body.companyId === '') {
        return { ...prepared, companyId: null, companyName: '', logoMode: 'category', merchantDomain: undefined };
    }
    if (typeof body.companyId !== 'string' || !/^[a-f\d]{24}$/i.test(body.companyId)) {
        throw invalidCompany('Некорректный идентификатор компании');
    }
    prepared.companyId = body.companyId.toLowerCase();
    if (current?.companyId && String(current.companyId) === prepared.companyId) {
        if (typeof current.companyName === 'string') prepared.companyName = current.companyName;
        else delete prepared.companyName;
        return prepared;
    }
    const query = Company.findById(prepared.companyId).lean();
    if (session) query.session(session);
    const company = await query;
    if (!company) throw invalidCompany('Компания не найдена. Выберите её заново.');
    prepared.companyName = company.name;
    prepared.logoMode = company.logoMode || 'auto';
    prepared.merchantDomain = company.logoMode === 'domain' ? company.merchantDomain : undefined;
    return prepared;
}

module.exports = { prepareTransactionCompany };

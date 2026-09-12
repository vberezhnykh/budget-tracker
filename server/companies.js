const express = require('express');
const mongoose = require('mongoose');
const { normalizeMerchantDomain } = require('./merchantDomain');

const COMPANY_LOGO_MODES = ['auto', 'domain', 'category'];

function normalizeCompanyName(raw) {
    if (typeof raw !== 'string' || raw.length > 1000) return null;
    const name = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!name || name.length > 120 || /\p{Cc}/u.test(name)) return null;
    const normalizedName = name.toLowerCase().replace(/\s*&\s*/gu, ' & ').replace(/\s+/gu, ' ').trim();
    return { name, normalizedName };
}

function validateCompanyInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Некорректные данные компании' };
    const normalized = normalizeCompanyName(body.name);
    if (!normalized) return { error: 'Название компании должно содержать от 1 до 120 символов' };
    if (!COMPANY_LOGO_MODES.includes(body.logoMode)) return { error: 'Выберите способ отображения иконки компании' };
    const company = { ...normalized, logoMode: body.logoMode };
    if (body.logoMode === 'domain') {
        const merchantDomain = normalizeMerchantDomain(body.merchantDomain);
        if (!merchantDomain) return { error: 'Укажите домен компании без протокола, пути и порта' };
        company.merchantDomain = merchantDomain;
    }
    return { company };
}

function serializeCompany(company) {
    return {
        _id: String(company._id),
        __v: Number.isSafeInteger(company.__v) ? company.__v : 0,
        name: company.name,
        logoMode: company.logoMode || 'auto',
        ...(company.logoMode === 'domain' && company.merchantDomain ? { merchantDomain: company.merchantDomain } : {})
    };
}

function createCompaniesRouter() {
    // The schema uses the pure name helper above. Resolving the model here,
    // after this module has loaded, keeps that dependency free of init cycles.
    const Company = require('./models/Company');
    const router = express.Router();

    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.get('/', async (req, res) => {
        try {
            const companies = await Company.find().sort({ normalizedName: 1, _id: 1 }).lean();
            return res.json(companies.map(serializeCompany));
        } catch {
            return res.status(500).json({ code: 'COMPANIES_UNAVAILABLE', message: 'Не удалось загрузить компании' });
        }
    });

    const duplicateResponse = async (res, normalizedName) => {
        const existing = await Company.findOne({ normalizedName }).lean();
        return res.status(409).json({
            code: 'COMPANY_EXISTS', message: 'Компания с таким названием уже сохранена',
            ...(existing ? { company: serializeCompany(existing) } : {})
        });
    };

    router.post('/', async (req, res) => {
        const { company, error } = validateCompanyInput(req.body);
        if (error) return res.status(400).json({ code: 'INVALID_COMPANY', message: error });
        try {
            // The first two simultaneous saves must also meet the unique index.
            // init() reuses Mongoose's promise once the index is ready.
            await Company.init();
            const saved = await Company.create(company);
            return res.status(201).json(serializeCompany(saved));
        } catch (error) {
            if (error.code === 11000) {
                try { return await duplicateResponse(res, company.normalizedName); } catch { /* Use the controlled error below. */ }
            }
            return res.status(500).json({ code: 'COMPANY_SAVE_FAILED', message: 'Не удалось сохранить компанию' });
        }
    });

    router.put('/:id', async (req, res) => {
        if (!/^[a-fA-F0-9]{24}$/.test(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ code: 'INVALID_COMPANY', message: 'Некорректный идентификатор компании' });
        }
        const { company, error } = validateCompanyInput(req.body);
        if (error) return res.status(400).json({ code: 'INVALID_COMPANY', message: error });
        if (!Number.isSafeInteger(req.body.__v) || req.body.__v < 0) {
            return res.status(400).json({ code: 'INVALID_COMPANY_VERSION', message: 'Обновите список компаний перед сохранением' });
        }
        try {
            await Company.init();
            const saved = await Company.findOneAndUpdate({ _id: req.params.id, __v: req.body.__v }, {
                $set: company, $inc: { __v: 1 },
                ...(company.logoMode !== 'domain' ? { $unset: { merchantDomain: '' } } : {})
            }, { new: true, runValidators: true });
            if (saved) return res.json(serializeCompany(saved));
            if (!await Company.exists({ _id: req.params.id })) {
                return res.status(404).json({ code: 'COMPANY_NOT_FOUND', message: 'Компания не найдена' });
            }
            return res.status(409).json({ code: 'COMPANY_STALE', message: 'Компания уже изменена. Обновите список и повторите попытку' });
        } catch (error) {
            if (error.code === 11000) {
                try { return await duplicateResponse(res, company.normalizedName); } catch { /* Use the controlled error below. */ }
            }
            return res.status(500).json({ code: 'COMPANY_SAVE_FAILED', message: 'Не удалось сохранить компанию' });
        }
    });

    return router;
}

module.exports = { COMPANY_LOGO_MODES, createCompaniesRouter, normalizeCompanyName, validateCompanyInput };

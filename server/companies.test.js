// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { normalizeCompanyName } from './companies.js';
import { clearCollections, connectTestDb, DB_HOOK_TIMEOUT, disconnectTestDb, loginAgent, tx } from './test/harness.js';

let app;
let agent;
let Company;
let Transaction;
const chosenCompany = { name: 'Mr & Mrs Pet', logoMode: 'domain', merchantDomain: 'mrpet.com' };

beforeAll(async () => {
    app = await connectTestDb('company-registry');
    agent = await loginAgent(app);
    Company = mongoose.model('Company');
    Transaction = mongoose.model('Transaction');
}, DB_HOOK_TIMEOUT);
afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('company name normalization', () => {
    it('preserves display case and punctuation while normalizing compatibility characters and whitespace', () => {
        expect(normalizeCompanyName('  Ｍｒ\u00a0＆  Ｍｒｓ Pet  ')).toEqual({ name: 'Mr & Mrs Pet', normalizedName: 'mr & mrs pet' });
        expect(normalizeCompanyName('Mr&Mrs Pet').normalizedName).toBe('mr & mrs pet');
        expect(normalizeCompanyName('MR &MRS PET').normalizedName).toBe('mr & mrs pet');
        expect(normalizeCompanyName('Mr. & Mrs. Pet').normalizedName).not.toBe('mr & mrs pet');
    });
});

describe('company registry API', () => {
    it('requires authentication for listing, creating and updating companies', async () => {
        expect((await request(app).get('/api/companies')).status).toBe(401);
        expect((await request(app).post('/api/companies').send(chosenCompany)).status).toBe(401);
        expect((await request(app).put(`/api/companies/${new mongoose.Types.ObjectId()}`).send({ ...chosenCompany, __v: 0 })).status).toBe(401);
        expect(await Company.countDocuments()).toBe(0);
    });

    it('does not migrate legacy descriptions on a read', async () => {
        await Transaction.create(tx({ description: 'Mr & Mrs Pet', logoMode: 'domain', merchantDomain: 'mrpet.com' }));
        const result = await agent.get('/api/companies');
        expect(result.status).toBe(200);
        expect(result.body).toEqual([]);
        expect(result.headers['cache-control']).toBe('no-store');
        expect(await Company.countDocuments()).toBe(0);
    });

    it('creates normalized companies and exposes only public fields in a stable list order', async () => {
        const created = await agent.post('/api/companies').send({
            name: '  Mr  & Mrs Pet ', logoMode: 'domain', merchantDomain: ' MRPET.COM ',
            normalizedName: 'poisoned', __v: 99, secret: 'ignored'
        });
        expect(created.status).toBe(201);
        expect(created.body).toEqual({ _id: expect.any(String), __v: 0, ...chosenCompany });
        expect((await Company.findById(created.body._id).lean()).normalizedName).toBe('mr & mrs pet');
        await agent.post('/api/companies').send({ name: 'Zoo Shop', logoMode: 'auto' });
        await agent.post('/api/companies').send({ name: 'Alpha', logoMode: 'category', merchantDomain: 'ignored.com' });
        const listed = await agent.get('/api/companies');
        expect(listed.body.map(company => company.name)).toEqual(['Alpha', 'Mr & Mrs Pet', 'Zoo Shop']);
        expect(listed.body[0]).toEqual({ _id: expect.any(String), __v: 0, name: 'Alpha', logoMode: 'category' });
        expect(listed.body[2]).not.toHaveProperty('merchantDomain');
    });

    it('rejects duplicate normalized names and returns the existing company for selection', async () => {
        const first = await agent.post('/api/companies').send(chosenCompany);
        const duplicate = await agent.post('/api/companies').send({ name: ' ＭＲ＆ＭＲＳ   PET ', logoMode: 'category' });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body).toEqual({ code: 'COMPANY_EXISTS', message: expect.any(String), company: first.body });
        expect(await Company.countDocuments()).toBe(1);
        expect((await Company.findById(first.body._id)).logoMode).toBe('domain');
    });

    it('enforces uniqueness for simultaneous saves too', async () => {
        const results = await Promise.all([
            agent.post('/api/companies').send(chosenCompany),
            agent.post('/api/companies').send({ ...chosenCompany, name: 'mr&mrs pet' })
        ]);
        expect(results.map(result => result.status).sort()).toEqual([201, 409]);
        expect(await Company.countDocuments()).toBe(1);
    });

    it.each([
        {}, [], { name: '', logoMode: 'auto' }, { name: '  ', logoMode: 'auto' },
        { name: 'x'.repeat(121), logoMode: 'auto' }, { name: 42, logoMode: 'auto' },
        { name: 'Bad\u0000Name', logoMode: 'auto' }, { name: 'Pet' }, { name: 'Pet', logoMode: 'image' },
        { name: 'Pet', logoMode: 'domain' }, { name: 'Pet', logoMode: 'domain', merchantDomain: 'https://mrpet.com' },
        { name: 'Pet', logoMode: 'domain', merchantDomain: '127.0.0.1' },
        { name: 'Pet', logoMode: 'domain', merchantDomain: 'company.local' }
    ])('rejects invalid company input without saving: %j', async body => {
        const result = await agent.post('/api/companies').send(body);
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('INVALID_COMPANY');
        expect(await Company.countDocuments()).toBe(0);
    });

    it('updates a company, increments its version and removes a domain after category selection', async () => {
        const company = await Company.create(chosenCompany);
        const result = await agent.put(`/api/companies/${company._id}`).send({ name: ' New   Pet ', logoMode: 'category', merchantDomain: 'ignored.com', __v: 0 });
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ _id: String(company._id), __v: 1, name: 'New Pet', logoMode: 'category' });
        const stored = await Company.findById(company._id).lean();
        expect(stored.normalizedName).toBe('new pet');
        expect(stored).not.toHaveProperty('merchantDomain');
    });

    it('updates a domain then clears it on automatic mode', async () => {
        const company = await Company.create(chosenCompany);
        const domain = await agent.put(`/api/companies/${company._id}`).send({ ...chosenCompany, merchantDomain: ' NEWPET.COM ', __v: 0 });
        expect(domain.status).toBe(200);
        expect(domain.body.merchantDomain).toBe('newpet.com');
        const automatic = await agent.put(`/api/companies/${company._id}`).send({ name: chosenCompany.name, logoMode: 'auto', __v: 1 });
        expect(automatic.status).toBe(200);
        expect(automatic.body).toMatchObject({ logoMode: 'auto', __v: 2 });
        expect(await Company.findById(company._id).lean()).not.toHaveProperty('merchantDomain');
    });

    it('returns a stale-version conflict without overwriting the latest company', async () => {
        const company = await Company.create(chosenCompany);
        const first = await agent.put(`/api/companies/${company._id}`).send({ ...chosenCompany, name: 'Updated Pet', __v: 0 });
        expect(first.status).toBe(200);
        const stale = await agent.put(`/api/companies/${company._id}`).send({ ...chosenCompany, name: 'Lost update', __v: 0 });
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe('COMPANY_STALE');
        expect((await Company.findById(company._id)).name).toBe('Updated Pet');
    });

    it('allows only one of two concurrent updates with the same version', async () => {
        const company = await Company.create(chosenCompany);
        const results = await Promise.all([
            agent.put(`/api/companies/${company._id}`).send({ ...chosenCompany, name: 'First Pet', __v: 0 }),
            agent.put(`/api/companies/${company._id}`).send({ ...chosenCompany, name: 'Second Pet', __v: 0 })
        ]);
        expect(results.map(result => result.status).sort()).toEqual([200, 409]);
        expect((await Company.findById(company._id)).__v).toBe(1);
    });

    it('rejects renaming into an existing normalized name without changing either company', async () => {
        const first = await Company.create(chosenCompany);
        const second = await Company.create({ name: 'Another Pet', logoMode: 'category' });
        const result = await agent.put(`/api/companies/${second._id}`).send({ ...chosenCompany, name: 'MR&MRS PET', __v: 0 });
        expect(result.status).toBe(409);
        expect(result.body.code).toBe('COMPANY_EXISTS');
        expect(result.body.company._id).toBe(String(first._id));
        expect((await Company.findById(second._id)).name).toBe('Another Pet');
        expect((await Company.findById(second._id)).__v).toBe(0);
    });

    it('validates the ID, a complete payload and an explicit version on updates', async () => {
        const company = await Company.create(chosenCompany);
        expect((await agent.put('/api/companies/not-an-id').send({ ...chosenCompany, __v: 0 })).status).toBe(400);
        const missing = await agent.put(`/api/companies/${new mongoose.Types.ObjectId()}`).send({ ...chosenCompany, __v: 0 });
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe('COMPANY_NOT_FOUND');
        for (const __v of [undefined, null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
            const result = await agent.put(`/api/companies/${company._id}`).send({ ...chosenCompany, __v });
            expect(result.status).toBe(400);
            expect(result.body.code).toBe('INVALID_COMPANY_VERSION');
        }
        expect((await agent.put(`/api/companies/${company._id}`).send({ name: 'Pet', __v: 0 })).status).toBe(400);
        expect((await Company.findById(company._id)).__v).toBe(0);
    });

    it('never changes transaction snapshots when registry name or logo changes', async () => {
        const company = await Company.create(chosenCompany);
        const inserted = await Transaction.collection.insertOne({
            ...tx({ description: 'Food for cat', logoMode: 'domain', merchantDomain: 'mrpet.com' }),
            companyId: String(company._id), companyName: chosenCompany.name, __v: 3
        });
        const before = await Transaction.collection.findOne({ _id: inserted.insertedId });
        const result = await agent.put(`/api/companies/${company._id}`).send({ name: 'Rebranded Pet', logoMode: 'category', __v: 0 });
        expect(result.status).toBe(200);
        expect(await Transaction.collection.findOne({ _id: inserted.insertedId })).toEqual(before);
    });

    it('keeps schema validation and canonical name uniqueness on direct model writes', async () => {
        const company = await Company.create({ name: '  ＭＲ＆ＭＲＳ  Pet ', logoMode: 'auto', merchantDomain: 'ignored.com' });
        expect(company.name).toBe('MR&MRS Pet');
        expect(company.normalizedName).toBe('mr & mrs pet');
        expect(company.merchantDomain).toBeUndefined();
        await expect(Company.create(chosenCompany)).rejects.toMatchObject({ code: 11000 });
        await expect(Company.create({ name: 'Missing Domain', logoMode: 'domain' })).rejects.toThrow();
        await expect(Company.create({ name: 'Bad Domain', logoMode: 'domain', merchantDomain: 'https://mrpet.com' })).rejects.toThrow();
    });
});

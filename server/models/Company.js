const mongoose = require('mongoose');
const { COMPANY_LOGO_MODES, normalizeCompanyName } = require('../companies');
const { normalizeMerchantDomain } = require('../merchantDomain');

const CompanySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        validate: { validator: value => normalizeCompanyName(value) !== null, message: 'Invalid company name' }
    },
    normalizedName: { type: String, required: true },
    logoMode: { type: String, enum: COMPANY_LOGO_MODES, required: true, default: 'auto' },
    merchantDomain: {
        type: String,
        trim: true,
        lowercase: true,
        required: function() { return this.logoMode === 'domain'; },
        validate: {
            validator: value => value === undefined || normalizeMerchantDomain(value) !== null,
            message: 'merchantDomain must be a public hostname'
        }
    }
}, { timestamps: true });

CompanySchema.pre('validate', function normalizeCompany() {
    const normalized = normalizeCompanyName(this.name);
    if (normalized) { this.name = normalized.name; this.normalizedName = normalized.normalizedName; }
    if (this.logoMode !== 'domain') this.merchantDomain = undefined;
});

CompanySchema.index({ normalizedName: 1 }, { unique: true });

module.exports = mongoose.model('Company', CompanySchema);

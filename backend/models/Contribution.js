const mongoose = require('mongoose');

const ContributionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    txId: {
        type: String,
        default: ''
    },
    blockchain: {
        type: String,
        enum: ['on-chain', 'off-chain-fallback'],
        default: 'off-chain-fallback'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Contribution', ContributionSchema);

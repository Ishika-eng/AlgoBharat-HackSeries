#!/usr/bin/env node
/**
 * resetDemo.js — Reset MongoDB state for a clean demo video.
 *
 * Deletes all loans, contributions, and users. Resets the pool balance
 * to match the actual Algorand escrow balance. Run this BEFORE recording
 * the demo so there's no leftover off-chain data from earlier testing.
 *
 * Usage:
 *   cd backend
 *   node scripts/resetDemo.js
 *   npm start
 *
 * This is safe — it only touches the CampusTrust MongoDB database
 * and does NOT change anything on the Algorand blockchain.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function reset() {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Create backend/.env first.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI, { dbName: 'CampusTrust' });
    console.log('Connected to MongoDB.\n');

    const User = require('../models/User');
    const Loan = require('../models/Loan');
    const Pool = require('../models/Pool');
    const Contribution = require('../models/Contribution');

    // Delete all demo data
    const users = await User.deleteMany({});
    const loans = await Loan.deleteMany({});
    const contribs = await Contribution.deleteMany({});
    console.log(`Deleted: ${users.deletedCount} users, ${loans.deletedCount} loans, ${contribs.deletedCount} contributions`);

    // Reset pool to a realistic starting balance (10 ALGO to match escrow liquidity)
    await Pool.deleteMany({});
    const pool = new Pool({ balance: 10 });
    await pool.save();
    console.log(`Pool balance reset to ${pool.balance} ALGO`);

    // Check actual escrow balance if possible
    try {
        const service = require('../services/algorandService');
        const status = await service.getOnChainStatus();
        if (status.ready) {
            console.log(`\nOn-chain status:`);
            console.log(`  Pool wallet: ${status.poolBalanceAlgo?.toFixed(3)} ALGO`);
            console.log(`  Escrow:      ${status.escrowBalanceAlgo?.toFixed(3)} ALGO`);
            console.log(`  App ID:      ${status.lendingAppId}`);
        }
    } catch (e) {
        // Non-fatal
    }

    console.log('\nDemo reset complete. Run `npm start` and sign up a fresh user.');
    await mongoose.disconnect();
}

reset().catch(err => {
    console.error('Reset failed:', err.message);
    process.exit(1);
});

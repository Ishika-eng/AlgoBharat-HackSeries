const mongoose = require('mongoose');
const algosdk = require('algosdk');
const path = require('path');
const fs = require('fs');

// Load environment variables exactly like the server does
const envPath = path.resolve(__dirname, '.env');
console.log(`--- System Health Check ---`);
console.log(`Checking .env file at: ${envPath}`);

if (!fs.existsSync(envPath)) {
    console.error('❌ CRITICAL: .env file NOT FOUND in backend folder!');
    process.exit(1);
}

require('dotenv').config({ path: envPath });

async function runCheck() {
    console.log('\n1. Environment Variables:');
    const required = ['MONGO_URI', 'POOL_ADDRESS', 'POOL_MNEMONIC'];
    required.forEach(key => {
        if (process.env[key]) {
            console.log(`✅ ${key} is set`);
        } else {
            console.log(`❌ ${key} is MISSING`);
        }
    });

    console.log('\n2. MongoDB Atlas Connection:');
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            dbName: 'CampusTrust'
        });
        console.log(`✅ SUCCESS: Connected to Atlas host: ${mongoose.connection.host}`);
        console.log(`✅ Database name: ${mongoose.connection.name}`);

        // Count users to verify read
        const User = require('./models/User');
        const count = await User.countDocuments();
        console.log(`✅ Read Check: Current user count: ${count}`);

        // Verify write/delete permission
        console.log(`⏳ Write Check: Attempting to create temporary record...`);
        const testUser = await User.create({
            name: "Health Check Bot",
            email: `health_${Date.now()}@test.com`,
            password: "password123"
        });
        console.log(`✅ Write Check: Created document ID: ${testUser._id}`);

        await User.findByIdAndDelete(testUser._id);
        console.log(`✅ Delete Check: Successfully removed temporary record`);
    } catch (err) {
        console.error(`❌ FAILED: MongoDB Connection/Permission Error: ${err.message}`);
    }

    console.log('\n3. Algorand Configuration:');
    try {
        const poolAddr = process.env.POOL_ADDRESS;
        if (poolAddr && algosdk.isValidAddress(poolAddr)) {
            console.log(`✅ POOL_ADDRESS is valid: ${poolAddr}`);
        } else {
            console.log(`❌ POOL_ADDRESS is invalid or missing`);
        }

        const mnemonic = process.env.POOL_MNEMONIC;
        if (mnemonic) {
            try {
                algosdk.mnemonicToSecretKey(mnemonic);
                console.log(`✅ POOL_MNEMONIC is valid`);
            } catch (e) {
                console.log(`❌ POOL_MNEMONIC is invalid: ${e.message}`);
            }
        }
    } catch (err) {
        console.error(`❌ FAILED: Algorand Check: ${err.message}`);
    }

    console.log('\n--- End of Health Check ---');
    process.exit(0);
}

runCheck();

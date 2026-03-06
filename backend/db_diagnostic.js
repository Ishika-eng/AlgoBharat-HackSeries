const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config();

const uri = process.env.MONGO_URI;

async function diagnose() {
    console.log('--- MongoDB Diagnostic tool ---');
    console.log('1. Checking DNS resolution...');

    const host = uri.split('@')[1].split('/')[0];
    console.log(`Target Host: ${host}`);

    dns.resolve(host, (err, addresses) => {
        if (err) {
            console.error('❌ DNS Resolution Failed:', err.message);
            if (host.includes('+srv')) {
                console.log('💡 TIP: Your network might be blocking SRV records. Try using the "Standard Connection String" (driver 2.2.12 or older format) from the Atlas dashboard.');
            }
        } else {
            console.log('✅ DNS Resolved:', addresses);
        }
    });

    console.log('2. Attempting Database Connection...');
    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log('✅ SUCCESS: Connected to MongoDB Atlas!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Connection Failed:', err.message);
        console.log('\n--- Troubleshooting Checklist ---');
        console.log('- Is your IP whitelisted in Atlas (Network Access)?');
        console.log('- Are the username/password correct in the MONGO_URI?');
        console.log('- Are you on a restricted network (VPN, College WiFi)?');
        process.exit(1);
    }
}

diagnose();

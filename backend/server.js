const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
const envExists = fs.existsSync(envPath);
console.log(`[env] Looking for .env at: ${envPath}`);
console.log(`[env] .env file exists: ${envExists}`);
const dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
    console.log(`[env] dotenv load error: ${dotenvResult.error.message}`);
} else {
    console.log(`[env] dotenv loaded ${Object.keys(dotenvResult.parsed || {}).length} key(s) from .env`);
}
console.log(`[env] MONGO_URI present in process.env: ${!!process.env.MONGO_URI}`);

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.send('CampusTrust API is running');
});

if (process.env.NODE_ENV !== 'production') {
    app.get('/debug-config', (req, res) => {
        res.json({
            cachedConfig: {
                mongo_uri_set: !!process.env.MONGO_URI,
                pool_address_set: !!process.env.POOL_ADDRESS,
                pool_mnemonic_set: !!process.env.POOL_MNEMONIC,
                algod_server: process.env.ALGOD_SERVER || 'default-testnet'
            },
            dbState: mongoose.connection.readyState,
            dbHost: mongoose.connection.host,
            dbName: mongoose.connection.name
        });
    });
}

const startServer = async () => {
    try {
        if (!process.env.MONGO_URI) {
            console.error('');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('MONGO_URI is not set.');
            console.error('');
            console.error('Fix:');
            console.error(`  1. Create a file at: ${envPath}`);
            console.error('  2. Add this line to it:');
            console.error('     MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/CampusTrust?retryWrites=true&w=majority');
            console.error('  3. Run `npm start` again.');
            console.error('');
            console.error('If you are deploying to Railway/Vercel, set MONGO_URI as an env var in the dashboard.');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            throw new Error('MONGO_URI is not set');
        }

        await mongoose.connect(process.env.MONGO_URI, {
            dbName: 'CampusTrust' // Explicitly set to avoid defaulting to 'test'
        });

        console.log(`✅ MongoDB Connected`);
        console.log(`   Host: ${mongoose.connection.host}`);
        console.log(`   Database: ${mongoose.connection.name}`);

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    }
};

startServer();

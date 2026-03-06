const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').resolve(__dirname, '.env') });

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
            throw new Error('MONGO_URI is not set');
        }

        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
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

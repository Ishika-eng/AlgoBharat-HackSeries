const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const db = process.env.MONGO_URI;

mongoose.connect(db, {
    dbName: 'CampusTrust'
})
    .then(() => console.log("✅ MongoDB Connected (via config/db)"))
    .catch(err => console.log("❌ MongoDB Connection Error:", err));

module.exports = mongoose;

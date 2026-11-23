// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Safety production configurations
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // Return an error if a connection takes too long
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect()
};
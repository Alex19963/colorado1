const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL не установлен!");
  console.error("   Локально: создайте файл server/.env с DATABASE_URL=postgresql://...");
  console.error("   На Render: добавьте переменную окружения DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis:       30000,
  max:                     10,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

module.exports = pool;

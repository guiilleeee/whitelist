import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.resolve(__dirname, "..", "..", "..", "db", "schema.sql");
const seedPath = path.resolve(__dirname, "..", "..", "..", "db", "seed_questions.sql");

const schemaSql = fs.readFileSync(schemaPath, "utf8");
const seedSql = fs.readFileSync(seedPath, "utf8");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await pool.query(schemaSql);
    await pool.query(seedSql);
    console.log("Schema + seed applied.");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

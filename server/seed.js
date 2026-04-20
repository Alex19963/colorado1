/**
 * seed.js — очистка БД и заполнение сотрудниками.
 * Запуск: node seed.js
 * Сохраняет таблицу admin нетронутой.
 * Удалять этот файл после запуска не обязательно, повторный запуск безопасен.
 */

const sqlite3 = require("sqlite3").verbose();
const path    = require("path");

const db = new sqlite3.Database(path.join(__dirname, "database.db"));

const EMPLOYEES = [
  "Хикматулло",
  "Чурабек",
  "Исмоил",
  "Авнвар",
  "Махмадсаид",
  "Шахром",
  "Гавхаршо",
  "Бежан",
  "Садриддин",
  "Фарход",
];

const PASSWORD = "1234";

// Таблицы, которые нужно очистить (admin — не трогаем)
const TABLES_TO_CLEAR = [
  "employees",
  "shifts",
  "tasks",
  "task_assigned",
  "task_participants",
  "task_photos",
  "notifications",
  "advances",
  "salary_settings",
  "salary_payments",
];

db.serialize(() => {
  db.run("BEGIN TRANSACTION");

  // 1. Очищаем таблицы
  for (const table of TABLES_TO_CLEAR) {
    db.run(`DELETE FROM ${table}`, err => {
      if (err && !err.message.includes("no such table")) {
        console.error(`Ошибка очистки ${table}:`, err.message);
      }
    });
  }

  // 2. Сбрасываем автоинкремент (sqlite_sequence хранит счётчики AUTOINCREMENT)
  db.run(
    `DELETE FROM sqlite_sequence WHERE name IN (${TABLES_TO_CLEAR.map(() => "?").join(",")})`,
    TABLES_TO_CLEAR,
    err => {
      if (err) console.error("Ошибка сброса sqlite_sequence:", err.message);
    }
  );

  // 3. Вставляем сотрудников
  const stmt = db.prepare(
    "INSERT INTO employees (name, password, avatar, activeStart, lastEnd) VALUES (?, ?, NULL, NULL, NULL)"
  );

  for (const name of EMPLOYEES) {
    stmt.run([name, PASSWORD], err => {
      if (err) console.error(`Ошибка вставки "${name}":`, err.message);
      else     console.log(`✓ ${name}`);
    });
  }

  stmt.finalize();

  db.run("COMMIT", err => {
    if (err) {
      console.error("Ошибка транзакции:", err.message);
    } else {
      console.log("\nГотово. Таблица admin сохранена.");
    }
  });
});

db.close();

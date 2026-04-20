const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");

// ====================== TJ TIME (UTC+5) ======================
function getTJDateTime() {
  const now = new Date();

  // Смещение Таджикистан = UTC +5 часов
  const tzOffsetMs = 5 * 60 * 60 * 1000;

  // Переводим текущее время в TJ
  const tj = new Date(now.getTime() + tzOffsetMs);

  // Формируем строку YYYY-MM-DDTHH:mm:ss
  const Y = tj.getUTCFullYear();
  const M = String(tj.getUTCMonth() + 1).padStart(2, "0");
  const D = String(tj.getUTCDate()).padStart(2, "0");
  const h = String(tj.getUTCHours()).padStart(2, "0");
  const m = String(tj.getUTCMinutes()).padStart(2, "0");
  const s = String(tj.getUTCSeconds()).padStart(2, "0");

  return `${Y}-${M}-${D}T${h}:${m}:${s}`;
}
// ============================================================


const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "12mb" }));

/* ── Security headers ── */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ── Multer: MIME-тип whitelist ── */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
function imageFileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Разрешены только изображения (jpeg, png, gif, webp)"), false);
  }
}

/* ── Multer: аватары сотрудников ── */
const storageEmployee = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "employees");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext);
  }
});
const uploadEmployee = multer({ storage: storageEmployee, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFileFilter });

/* ── Multer: фото заданий ── */
const storageTask = multer.diskStorage({
  destination: (req, file, cb) => {
    const today = getTJDateTime().substring(0, 10);
    const dir = path.join(__dirname, "uploads", "tasks", today);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext);
  }
});
const uploadTask = multer({ storage: storageTask, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFileFilter });

const db = new sqlite3.Database(__dirname + "/database.db");

/* ─── SSE: real-time push to all open admin tabs ─────────────────── */
const sseClients = new Set();

function broadcast(event, data = {}) {
  if (!sseClients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); }
    catch (e) { sseClients.delete(res); }
  }
}

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(":connected\n\n");

  sseClients.add(res);
  const keepAlive = setInterval(() => { try { res.write(":ping\n\n"); } catch { clearInterval(keepAlive); } }, 25000);
  req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
});

/* =====================================================
   ===============   СОЗДАНИЕ ТАБЛИЦ   =================
   ===================================================== */
db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      status TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      date TEXT,
      time TEXT,
      message TEXT,
      status TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT,
      password TEXT,
      token TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      password TEXT,
      avatar TEXT,
      activeStart TEXT,
      lastEnd TEXT
    )
  `);

  db.run(`
    ALTER TABLE employees ADD COLUMN avatar TEXT
  `, err => {
    if (err && !String(err.message).includes("duplicate column")) {
      console.error("Ошибка при добавлении колонки avatar:", err.message);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      description TEXT,
      type TEXT,
      created_at TEXT
    )
  `);

  db.run(`
  ALTER TABLE tasks
  ADD COLUMN status TEXT DEFAULT 'in_progress'
`, () => {});

// Добавляем колонку "title", если её ещё нет
db.run(`
  ALTER TABLE tasks ADD COLUMN title TEXT DEFAULT ''
`, err => {
  if (err && !String(err.message).includes("duplicate column")) {
    console.error("Ошибка при добавлении колонки title:", err.message);
  }
});

// Время дедлайна
db.run(`ALTER TABLE tasks ADD COLUMN due_time TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("due_time:", err.message);
});

// Флаг: уведомление об опоздании уже отправлено
db.run(`ALTER TABLE tasks ADD COLUMN overdue_notified INTEGER DEFAULT 0`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("overdue_notified:", err.message);
});

// Время начала задания
db.run(`ALTER TABLE tasks ADD COLUMN time_from TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("time_from:", err.message);
});

// Главный сотрудник задания
db.run(`ALTER TABLE tasks ADD COLUMN main_employee_id INTEGER`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("main_employee_id:", err.message);
});

// Рейтинг задания (0 = не выставлен, 1-5)
db.run(`ALTER TABLE tasks ADD COLUMN rating INTEGER DEFAULT 0`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("tasks.rating:", err.message);
});

// Дата/время завершения задания
db.run(`ALTER TABLE tasks ADD COLUMN completed_at TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("tasks.completed_at:", err.message);
});

// Выбранный день выполнения для отчёта
db.run(`ALTER TABLE tasks ADD COLUMN completion_day TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("tasks.completion_day:", err.message);
});

// Путь к файлу фото задания
db.run(`ALTER TABLE task_photos ADD COLUMN photo_path TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("task_photos.photo_path:", err.message);
});

// Структурированные поля уведомлений
db.run(`ALTER TABLE notifications ADD COLUMN task_title TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("notifications.task_title:", err.message);
});
db.run(`ALTER TABLE notifications ADD COLUMN task_due_time TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("notifications.task_due_time:", err.message);
});
db.run(`ALTER TABLE notifications ADD COLUMN notif_type TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("notifications.notif_type:", err.message);
});
db.run(`ALTER TABLE notifications ADD COLUMN task_extra TEXT`, err => {
  if (err && !String(err.message).includes("duplicate column"))
    console.error("notifications.task_extra:", err.message);
});




  db.run(`
    CREATE TABLE IF NOT EXISTS task_assigned (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      employee_id INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      employee_id INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_photos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL,
      employee_id INTEGER,
      photo_data  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tph_task ON task_photos(task_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS advances (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      amount      REAL    NOT NULL,
      date        TEXT    NOT NULL,
      comment     TEXT,
      created_at  TEXT    NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_adv_emp  ON advances(employee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_adv_date ON advances(date)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS salary_settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      year        INTEGER NOT NULL,
      month       INTEGER NOT NULL,
      rate        REAL    DEFAULT 0,
      norm_hours  REAL    DEFAULT 160,
      UNIQUE(employee_id, year, month)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS salary_payments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      amount      REAL    NOT NULL,
      date        TEXT    NOT NULL,
      comment     TEXT    DEFAULT '',
      created_at  TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id  INTEGER NOT NULL,
      old_amount  REAL,
      new_amount  REAL,
      changed_at  TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL,
      author     TEXT NOT NULL,
      comment    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  // Миграции salary_settings
  db.run(`ALTER TABLE salary_settings ADD COLUMN salary REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE salary_settings ADD COLUMN rate REAL DEFAULT 0`, err => {
    if (err && !String(err.message).includes("duplicate column")) {
      console.error("salary_settings.rate:", err.message);
    }
  });

  db.run(`ALTER TABLE employees ADD COLUMN salary REAL DEFAULT 0`, err => {
    if (err && !String(err.message).includes("duplicate column")) {
      console.error("Ошибка при добавлении колонки salary:", err.message);
    }
  });

  /* ── Индексы для ускорения запросов ── */
  db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_emp    ON shifts(employee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(employee_id, status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_date    ON tasks(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_overdue ON tasks(status, overdue_notified)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ta_task       ON task_assigned(task_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ta_emp        ON task_assigned(employee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tp_task       ON task_participants(task_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notif_emp     ON notifications(employee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notif_date    ON notifications(date)`);

  db.get("SELECT * FROM admin LIMIT 1", (err, row) => {
    if (!row) {
      const token = crypto.randomBytes(32).toString("hex");
      db.run(
        "INSERT INTO admin (login, password, token) VALUES (?,?,?)",
        ["admin", "admin", token]
      );
      console.log("✔ Администратор создан: admin / admin");
      console.log("✔ TOKEN:", token);
    }
  });
});

/* =====================================================
   =================   АВТОРИЗАЦИЯ   ====================
   ===================================================== */

/* ── Rate limiter для login (макс 10 попыток в минуту с одного IP) ── */
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxAttempts = 10;
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  if (entry.count > maxAttempts) {
    return res.status(429).json({ error: "Слишком много попыток. Подождите минуту." });
  }
  next();
}

app.post("/api/admin/login", loginRateLimit, (req, res) => {
  const { login, password } = req.body;

  db.get(
    "SELECT * FROM admin WHERE login = ? AND password = ?",
    [login, password],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      if (!row) return res.status(401).json({ error: "Неверные данные" });
      res.json({ token: row.token });
    }
  );
});

/* ── Авторизация сотрудника (серверная сторона) ── */
app.post("/api/employees/login", loginRateLimit, (req, res) => {
  const { password } = req.body;
  if (!password || !password.trim()) {
    return res.status(400).json({ error: "Введите пароль" });
  }
  db.get(
    "SELECT id, name, avatar, activeStart, lastEnd, salary FROM employees WHERE password = ? LIMIT 1",
    [password.trim()],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      if (!row) return res.status(401).json({ error: "Неверный пароль" });
      res.json(row);
    }
  );
});

// Проверить токен администратора
app.get("/api/admin/verify", (req, res) => {
  const token = req.headers["x-admin-token"] || req.query.token || "";
  if (!token) return res.status(401).json({ ok: false });
  db.get("SELECT id FROM admin WHERE token = ?", [token.trim()], (err, row) => {
    if (err || !row) return res.status(401).json({ ok: false });
    res.json({ ok: true });
  });
});

/* ── Middleware: проверка токена администратора ── */
function requireAdmin(req, res, next) {
  const token = (req.headers["x-admin-token"] || req.query.token || "").trim();
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });
  db.get("SELECT id FROM admin WHERE token = ?", [token], (err, row) => {
    if (err || !row) return res.status(401).json({ error: "Неверный токен" });
    next();
  });
}

/* =====================================================
   =================   АДМИН-АККАУНТ   =================
   ===================================================== */

// Активные сессии админ-панели: sessionId -> lastPing (timestamp)
const activeSessions = new Map();

// Heartbeat — клиент пингует каждые 30 сек
app.post("/api/admin/heartbeat", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  activeSessions.set(sessionId, Date.now());
  res.json({ ok: true });
});

// Количество онлайн-пользователей
app.get("/api/admin/online", (req, res) => {
  const threshold = Date.now() - 60 * 1000;
  let count = 0;
  for (const [id, ts] of activeSessions) {
    if (ts > threshold) count++;
    else activeSessions.delete(id);
  }
  res.json({ count });
});

// Получить логин администратора (без пароля)
app.get("/api/admin/info", requireAdmin, (req, res) => {
  db.get("SELECT login FROM admin LIMIT 1", (err, row) => {
    if (err || !row) return res.status(500).json({ error: "Ошибка БД" });
    res.json(row);
  });
});

// Изменить логин
app.patch("/api/admin/login", requireAdmin, (req, res) => {
  const login = String(req.body.login || "").trim();
  if (!login) return res.status(400).json({ error: "Логин не может быть пустым" });
  db.run("UPDATE admin SET login = ? WHERE id = 1", [login], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json({ ok: true });
  });
});

// Изменить пароль
app.patch("/api/admin/password", requireAdmin, (req, res) => {
  const password = String(req.body.password || "").trim();
  if (!password) return res.status(400).json({ error: "Пароль не может быть пустым" });
  db.run("UPDATE admin SET password = ? WHERE id = 1", [password], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json({ ok: true });
  });
});

/* =====================================================
   =================   ЗАГРУЗКА ФАЙЛОВ   ================
   ===================================================== */

// Аватар сотрудника
app.post("/api/upload/avatar", requireAdmin, uploadEmployee.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Нет файла" });
  res.json({ url: "/uploads/employees/" + req.file.filename });
});

// Фото задания
app.post("/api/upload/task-photo", uploadTask.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Нет файла" });
  const today = getTJDateTime().substring(0, 10);
  res.json({ url: "/uploads/tasks/" + today + "/" + req.file.filename });
});

/* =====================================================
   =================   СОТРУДНИКИ   =====================
   ===================================================== */

// Получить всех сотрудников (без паролей)
app.get("/api/employees", (req, res) => {
  db.all("SELECT id, name, avatar, activeStart, lastEnd, salary, password FROM employees", (err, rows) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json(rows || []);
  });
});

// Получить одного сотрудника по id
app.get("/api/employees/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT id, name, avatar, activeStart, lastEnd, salary, password FROM employees WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    if (!row) return res.status(404).json({ error: "Сотрудник не найден" });
    res.json(row);
  });
});

// =====================================================
//   ДОБАВИТЬ СОТРУДНИКА + ПРОВЕРКА НА ДУБЛИКАТ
// =====================================================
app.post("/api/employees", requireAdmin, (req, res) => {
  let { name, password, avatar } = req.body;

  name = String(name || "").trim();
  password = String(password || "").trim();
  avatar = String(avatar || "").trim();

  if (!name || !password) {
    return res.status(400).json({ error: "Требуются поля name и password" });
  }
  if (!/^\d{4,}$/.test(password)) {
    return res.status(400).json({ error: "Пароль должен содержать минимум 4 цифры (только цифры 0–9)" });
  }

  db.get("SELECT id FROM employees WHERE name = ? LIMIT 1", [name], (err, nameRow) => {
    if (err) return res.status(500).json({ error: "Ошибка проверки имени" });
    if (nameRow) return res.status(409).json({ error: "Сотрудник с таким именем уже существует" });

    db.get("SELECT id FROM employees WHERE password = ? LIMIT 1", [password], (err2, passRow) => {
      if (err2) return res.status(500).json({ error: "Ошибка проверки пароля" });
      if (passRow) return res.status(409).json({ error: "Пароль уже используется другим сотрудником" });

      db.run(
        "INSERT INTO employees (name, password, avatar, activeStart, lastEnd) VALUES (?, ?, ?, ?, ?)",
        [name, password, avatar, null, null],
        function (err3) {
          if (err3) return res.status(500).json({ error: "Ошибка при добавлении сотрудника" });
          broadcast("employees");
          res.json({ id: this.lastID, message: "Сотрудник успешно добавлен" });
        }
      );
    });
  });
});










// Получить смены сотрудника
app.get("/api/employees/:id/shifts", (req, res) => {
  const id = req.params.id;
  db.all("SELECT * FROM shifts WHERE employee_id = ? ORDER BY id DESC", [id], (err, rows) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json(rows || []);
  });
});





   

// Обновить имя, фото и/или пароль сотрудника
app.patch("/api/employees/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const { name, avatar, password } = req.body;
  const trimmedName = String(name || "").trim();
  if (!trimmedName) return res.status(400).json({ error: "Имя не может быть пустым" });

  const fields = ["name = ?"];
  const values = [trimmedName];
  if (avatar !== undefined) { fields.push("avatar = ?"); values.push(avatar || null); }
  if (password !== undefined && String(password).trim()) {
    const trimmedPwd = String(password).trim();
    if (!/^\d{4,}$/.test(trimmedPwd)) {
      return res.status(400).json({ error: "Пароль должен содержать минимум 4 цифры (только цифры 0–9)" });
    }
    fields.push("password = ?");
    values.push(trimmedPwd);
  }
  values.push(id);

  const doUpdate = (oldAvatar) => {
    db.run(`UPDATE employees SET ${fields.join(", ")} WHERE id = ?`, values, err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      if (oldAvatar && oldAvatar.startsWith("/uploads/")) {
        fs.unlink(path.join(__dirname, oldAvatar), () => {});
      }
      broadcast("employees");
      res.json({ ok: true });
    });
  };

  if (avatar !== undefined) {
    db.get("SELECT avatar FROM employees WHERE id = ?", [id], (_err, row) => {
      doUpdate(row ? row.avatar : null);
    });
  } else {
    doUpdate(null);
  }
});

// Завершить все активные задания сотрудника (пометить как done)
app.post("/api/employees/:id/complete-tasks", requireAdmin, (req, res) => {
  const empId = req.params.id;
  db.run(
    `UPDATE tasks SET status = 'done'
     WHERE status != 'done'
       AND id IN (
         SELECT task_id FROM task_assigned WHERE employee_id = ?
         UNION
         SELECT task_id FROM task_participants WHERE employee_id = ?
       )`,
    [empId, empId],
    function (err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      broadcast("tasks");
      broadcast("employees");
      res.json({ ok: true, updated: this.changes });
    }
  );
});

// =====================================================
//        НАЧАТЬ СМЕНУ — АНТИДВОЙНОЙ ЗАЩИТНЫЙ ВАРИАНТ
// =====================================================
app.patch("/api/employees/:id/start", (req, res) => {
  const id = req.params.id;

  const localISO = getTJDateTime();


  db.serialize(() => {
    // Проверяем, есть ли открытая смена
    db.get(
      "SELECT * FROM shifts WHERE employee_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
      [id],
      (err, row) => {
        if (err) {
          console.error("Ошибка проверки смены:", err);
          return res.status(500).json({ error: "Ошибка при проверке смены" });
        }

        // Уже есть — возвращаем
        if (row) {
          console.log(`⚠️ Смена уже открыта для сотрудника #${id}`);
          return res.json({ success: true, start: row.start_time });
        }

        // Создаём новую
        db.run(
          "INSERT INTO shifts (employee_id, start_time, status) VALUES (?, ?, 'open')",
          [id, localISO],
          function (err2) {
            if (err2) {
              console.error("Ошибка создания смены:", err2);
              return res.status(500).json({ error: "Ошибка при создании смены" });
            }

            console.log(`▶️ Смена начата для #${id} в ${localISO}`);
            broadcast("employees");
            res.json({ success: true, start: localISO });
          }
        );
      }
    );
  });
});



// =====================================================
//        ЗАВЕРШИТЬ СМЕНУ — УМНЫЙ ИДЕМПОТЕНТНЫЙ ВАРИАНТ
// =====================================================
app.patch("/api/employees/:id/stop", (req, res) => {
  const id = req.params.id;

const localISO = getTJDateTime();

  db.serialize(() => {
    // Находим открытую смену
    db.get(
      "SELECT id FROM shifts WHERE employee_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
      [id],
      (err, openRow) => {
        if (err) {
          console.error("Ошибка поиска смены:", err);
          return res.status(500).json({ error: "Ошибка БД" });
        }

        // Если нет открытой — проверим на висящую
        if (!openRow) {
          db.get(
            "SELECT id FROM shifts WHERE employee_id = ? AND (end_time IS NULL OR end_time = '') ORDER BY id DESC LIMIT 1",
            [id],
            (err2, pendingRow) => {
              if (err2) {
                console.error("Ошибка поиска fallback-смены:", err2);
                return res.status(500).json({ error: "Ошибка поиска смены" });
              }

              if (!pendingRow) {
                console.warn(`❗ Нет открытой смены у #${id}`);
                return res.status(400).json({ error: "Нет открытой смены" });
              }

              closeShift(pendingRow.id);
            }
          );
        } else {
          closeShift(openRow.id);
        }

        // Функция завершения смены
        function closeShift(shiftId) {
          db.run(
            "UPDATE shifts SET end_time = ?, status = 'closed' WHERE id = ?",
            [localISO, shiftId],
            err3 => {
              if (err3) {
                console.error("Ошибка завершения:", err3);
                return res
                  .status(500)
                  .json({ error: "Ошибка при завершении смены" });
              }

              console.log(`⏹ Смена #${shiftId} завершена для сотрудника #${id}`);
              broadcast("employees");

              db.get(
                "SELECT * FROM shifts WHERE id = ?",
                [shiftId],
                (err4, row) => {
                  if (err4) {
                    console.error("Ошибка чтения завершённой смены:", err4);
                    return res
                      .status(500)
                      .json({ error: "Ошибка при проверке данных смены" });
                  }

                  res.json({
                    success: true,
                    lastShift: row,
                    lastEnd: row.end_time,
                    lastStatus: row.status,
                  });
                }
              );
            }
          );
        }
      }
    );
  });
});





// =====================================================
//                  ЗАДАНИЯ
// =====================================================

// Создать задание с назначенными сотрудниками
app.post("/api/tasks", requireAdmin, (req, res) => {
  const { date, title, description, type, assignedEmployees = [], due_time, time_from, mainEmployeeId } = req.body;
  const createdAt = getTJDateTime();

  db.run(
    `INSERT INTO tasks (date, title, description, type, created_at, due_time, time_from, main_employee_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [date, title || "", description || "", type, createdAt, due_time || null, time_from || null, mainEmployeeId || null],
    function (err) {
      if (err) {
        console.error("Ошибка при добавлении задания:", err);
        return res.status(500).json({ error: "Ошибка БД" });
      }

      const taskId = this.lastID;

      if (Array.isArray(assignedEmployees) && assignedEmployees.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO task_assigned (task_id, employee_id)
          VALUES (?, ?)
        `);

        assignedEmployees.forEach(empId => {
          stmt.run([taskId, empId]);
          db.run(
            "INSERT INTO task_participants (task_id, employee_id) VALUES (?, ?)",
            [taskId, empId]
          );
        });

        stmt.finalize();
      }

      broadcast("tasks");
      res.status(201).json({
        id: taskId,
        assignedEmployees,
        message: "Задание успешно добавлено"
      });
    }
  );
});




// ================== УЧАСТИЕ В ЗАДАНИЯХ ==================

// Сотрудник подключается к заданию
app.post("/api/tasks/:id/join", (req, res) => {
  const taskId = req.params.id;
  const { employee_id } = req.body;

  db.run(
    "INSERT INTO task_participants (task_id, employee_id) VALUES (?, ?)",
    [taskId, employee_id],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ success: true });
    }
  );
});

// Сотрудник выходит из задания
app.post("/api/tasks/:id/leave", (req, res) => {
  const taskId = req.params.id;
  const { employee_id } = req.body;

  db.run(
    "DELETE FROM task_participants WHERE task_id = ? AND employee_id = ?",
    [taskId, employee_id],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ success: true });
    }
  );
});

// Админ переключает статус задания
app.patch("/api/tasks/:id/toggle", requireAdmin, (req, res) => {
  const taskId = req.params.id;

  db.get("SELECT status FROM tasks WHERE id = ?", [taskId], (err, taskRow) => {
    if (err || !taskRow) {
      return res.status(404).json({ error: "Задание не найдено" });
    }

    // Проверяем, есть ли назначенные сотрудники или участники
    db.all(
      `
      SELECT employee_id FROM task_assigned WHERE task_id = ?
      UNION
      SELECT employee_id FROM task_participants WHERE task_id = ?
      `,
      [taskId, taskId],
      (err2, rows) => {
        if (err2) return res.status(500).json({ error: "Ошибка БД при проверке сотрудников" });

        // ❗ Если нет ни одного сотрудника — запрещаем менять статус
        if (!rows || rows.length === 0) {
          return res.status(400).json({
            error: "Нельзя завершить задание без выбранных сотрудников"
          });
        }

        // Всё ок — переключаем статус
        const nextStatus = taskRow.status === "done" ? "in_progress" : "done";
        const completedAt = nextStatus === "done" ? getTJDateTime() : null;

        db.run(
          "UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?",
          [nextStatus, completedAt, taskId],
          err3 => {
            if (err3) return res.status(500).json({ error: "Ошибка обновления статуса" });
            broadcast("tasks");
            res.json({ status: nextStatus });
          }
        );
      }
    );
  });
});


// Переключить статус задания главным сотрудником (done ↔ in_progress, без admin-токена)
app.patch("/api/tasks/:id/complete-by-employee", (req, res) => {
  const taskId     = Number(req.params.id);
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId обязателен" });

  db.get("SELECT id, status, main_employee_id FROM tasks WHERE id = ?", [taskId], (err, task) => {
    if (err || !task) return res.status(404).json({ error: "Задание не найдено" });
    if (task.main_employee_id !== Number(employeeId)) {
      return res.status(403).json({ error: "Только главный сотрудник может изменить статус" });
    }

    const nextStatus  = task.status === "done" ? "in_progress" : "done";
    const completedAt = nextStatus === "done" ? getTJDateTime() : null;

    db.run(
      "UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?",
      [nextStatus, completedAt, taskId],
      err2 => {
        if (err2) return res.status(500).json({ error: "Ошибка обновления статуса" });
        broadcast("tasks");
        res.json({ status: nextStatus });
      }
    );
  });
});

// Рейтинг задания
app.patch("/api/tasks/:id/rating", requireAdmin, (req, res) => {
  const { rating } = req.body;
  const taskId = Number(req.params.id);
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Рейтинг 1–5" });
  db.run("UPDATE tasks SET rating = ? WHERE id = ?", [rating, taskId], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    broadcast("tasks");
    res.json({ ok: true });
  });
});

// Сохранить выбранный день выполнения (для отчёта)
app.patch("/api/tasks/:id/completion_day", requireAdmin, (req, res) => {
  const { completion_day } = req.body;
  const taskId = req.params.id;
  db.run(
    "UPDATE tasks SET completion_day = ? WHERE id = ?",
    [completion_day || null, taskId],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ ok: true });
    }
  );
});

// Изменить задание + обновить сотрудников (без дублей и с удалением лишних)
app.patch("/api/tasks/:id", requireAdmin, (req, res) => {
  const { date, title, description, assignedEmployees = [], due_time, time_from, mainEmployeeId } = req.body;
  const id = req.params.id;

  db.run(
    "UPDATE tasks SET date = ?, title = ?, description = ?, due_time = ?, time_from = ?, main_employee_id = ?, overdue_notified = 0 WHERE id = ?",
    [date, title || "", description || "", due_time || null, time_from || null, mainEmployeeId || null, id],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД при обновлении задания" });

      // Удаляем старые связи
      db.run("DELETE FROM task_assigned WHERE task_id = ?", [id], err2 => {
        if (err2) return res.status(500).json({ error: "Ошибка при очистке сотрудников" });

        // Обновляем task_assigned
        const stmt = db.prepare("INSERT INTO task_assigned (task_id, employee_id) VALUES (?, ?)");
        assignedEmployees.forEach(empId => stmt.run([id, empId]));
        stmt.finalize();

        // === Обновляем участников ===
        db.all("SELECT employee_id FROM task_participants WHERE task_id = ?", [id], (err3, rows) => {
          if (!err3 && rows) {
            const currentIds = rows.map(r => r.employee_id);
            const toRemove = currentIds.filter(eid => !assignedEmployees.includes(eid));
            toRemove.forEach(empId => {
              db.run("DELETE FROM task_participants WHERE task_id = ? AND employee_id = ?", [id, empId]);
            });
          }

          assignedEmployees.forEach(empId => {
            db.get(
              "SELECT id FROM task_participants WHERE task_id = ? AND employee_id = ?",
              [id, empId],
              (err, row) => {
                if (!err && !row) {
                  db.run(
                    "INSERT INTO task_participants (task_id, employee_id) VALUES (?, ?)",
                    [id, empId]
                  );
                }
              }
            );
          });

          broadcast("tasks");
          res.json({ success: true, assignedEmployees });
        });
      });
    }
  );
});


// Удалить задание — с транзакцией для целостности данных
app.delete("/api/tasks/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  db.serialize(() => {
    db.run("BEGIN");
    db.run("DELETE FROM task_assigned     WHERE task_id = ?", [id]);
    db.run("DELETE FROM task_participants WHERE task_id = ?", [id]);
    db.run("DELETE FROM tasks             WHERE id = ?",      [id], err => {
      if (err) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: "Ошибка БД" });
      }
      db.run("COMMIT");
      broadcast("tasks");
      res.json({ success: true });
    });
  });
});


// Получить все задания — одним JOIN вместо трёх отдельных запросов
app.get("/api/tasks", (req, res) => {
  db.all(`
    SELECT t.*,
           GROUP_CONCAT(DISTINCT ta.employee_id) AS assigned_ids,
           GROUP_CONCAT(DISTINCT tp.employee_id) AS participant_ids,
           COUNT(DISTINCT tph.id)                AS photo_count
    FROM tasks t
    LEFT JOIN task_assigned     ta  ON ta.task_id  = t.id
    LEFT JOIN task_participants tp  ON tp.task_id  = t.id
    LEFT JOIN task_photos       tph ON tph.task_id = t.id
    GROUP BY t.id
    ORDER BY t.date DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    const result = (rows || []).map(r => {
      const { assigned_ids, participant_ids, ...rest } = r;
      return {
        ...rest,
        assignedEmployees: assigned_ids ? assigned_ids.split(",").map(Number) : [],
        participants:      participant_ids ? participant_ids.split(",").map(Number) : [],
        photoCount: rest.photo_count || 0
      };
    });
    res.json(result);
  });
});

// Получить фото задания
app.get("/api/tasks/:id/photos", (req, res) => {
  const taskId = req.params.id;
  db.all(
    `SELECT tp.id, tp.task_id, tp.employee_id, tp.photo_data, tp.photo_path, tp.created_at,
            e.name AS employee_name
     FROM task_photos tp
     LEFT JOIN employees e ON e.id = tp.employee_id
     WHERE tp.task_id = ?
     ORDER BY tp.created_at ASC`,
    [taskId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json(rows || []);
    }
  );
});

// Загрузить фото к заданию
app.post("/api/tasks/:id/photos", (req, res) => {
  const taskId = req.params.id;
  const { photoData, photo_path, employeeId } = req.body;
  if (!photoData && !photo_path) return res.status(400).json({ error: "Нет данных фото" });
  db.get("SELECT status FROM tasks WHERE id = ?", [taskId], (err, task) => {
    if (err || !task) return res.status(404).json({ error: "Задание не найдено" });
    if (task.status === "done") return res.status(403).json({ error: "Нельзя добавлять фото к выполненному заданию" });
    const createdAt = getTJDateTime();
    db.run(
      `INSERT INTO task_photos (task_id, employee_id, photo_data, photo_path, created_at) VALUES (?, ?, ?, ?, ?)`,
      [taskId, employeeId || null, photoData || "", photo_path || null, createdAt],
      function (err2) {
        if (err2) return res.status(500).json({ error: "Ошибка БД" });
        broadcast("tasks");
        res.status(201).json({ id: this.lastID });
      }
    );
  });
});

// Удалить фото
app.delete("/api/tasks/photos/:photoId", requireAdmin, (req, res) => {
  db.get("SELECT photo_path FROM task_photos WHERE id = ?", [req.params.photoId], (_err, row) => {
    db.run("DELETE FROM task_photos WHERE id = ?", [req.params.photoId], function (err2) {
      if (err2) return res.status(500).json({ error: "Ошибка БД" });
      if (row && row.photo_path && row.photo_path.startsWith("/uploads/")) {
        fs.unlink(path.join(__dirname, row.photo_path), () => {});
      }
      broadcast("tasks");
      res.json({ ok: true });
    });
  });
});

/* ── Комментарии к заданиям ───────────────────────────────────────── */

// GET /api/tasks/:id/comments — список комментариев
app.get("/api/tasks/:id/comments", (req, res) => {
  db.all(
    "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json(rows || []);
    }
  );
});

// PATCH /api/tasks/:id/comments/:cid — редактировать комментарий
app.patch("/api/tasks/:id/comments/:cid", requireAdmin, (req, res) => {
  const { comment } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: "Пустой комментарий" });
  db.run(
    "UPDATE task_comments SET comment = ? WHERE id = ? AND task_id = ?",
    [comment.trim(), req.params.cid, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      if (this.changes === 0) return res.status(404).json({ error: "Не найдено" });
      res.json({ ok: true });
    }
  );
});

// DELETE /api/tasks/:id/comments/:cid — удалить комментарий
app.delete("/api/tasks/:id/comments/:cid", requireAdmin, (req, res) => {
  db.run(
    "DELETE FROM task_comments WHERE id = ? AND task_id = ?",
    [req.params.cid, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ ok: true });
    }
  );
});

// PATCH /api/tasks/:id/comments/:cid/by-employee — сотрудник редактирует свой комментарий
app.patch("/api/tasks/:id/comments/:cid/by-employee", (req, res) => {
  const { comment, employeeName } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: "Пустой комментарий" });
  if (!employeeName)               return res.status(400).json({ error: "employeeName обязателен" });
  db.get(
    "SELECT id, author FROM task_comments WHERE id = ? AND task_id = ?",
    [req.params.cid, req.params.id],
    (err, row) => {
      if (err || !row) return res.status(404).json({ error: "Комментарий не найден" });
      if (row.author !== employeeName.trim())
        return res.status(403).json({ error: "Нельзя редактировать чужой комментарий" });
      db.run(
        "UPDATE task_comments SET comment = ? WHERE id = ?",
        [comment.trim(), req.params.cid],
        function (err2) {
          if (err2) return res.status(500).json({ error: "Ошибка БД" });
          res.json({ ok: true });
        }
      );
    }
  );
});

// DELETE /api/tasks/:id/comments/:cid/by-employee — сотрудник удаляет свой комментарий
app.delete("/api/tasks/:id/comments/:cid/by-employee", (req, res) => {
  const { employeeName } = req.body;
  if (!employeeName) return res.status(400).json({ error: "employeeName обязателен" });
  db.get(
    "SELECT id, author FROM task_comments WHERE id = ? AND task_id = ?",
    [req.params.cid, req.params.id],
    (err, row) => {
      if (err || !row) return res.status(404).json({ error: "Комментарий не найден" });
      if (row.author !== employeeName.trim())
        return res.status(403).json({ error: "Нельзя удалить чужой комментарий" });
      db.run("DELETE FROM task_comments WHERE id = ?", [req.params.cid], function (err2) {
        if (err2) return res.status(500).json({ error: "Ошибка БД" });
        res.json({ ok: true });
      });
    }
  );
});

// DELETE /api/tasks/photos/:photoId/by-employee — сотрудник удаляет своё фото
app.delete("/api/tasks/photos/:photoId/by-employee", (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId обязателен" });
  db.get(
    "SELECT id, employee_id, photo_path FROM task_photos WHERE id = ?",
    [req.params.photoId],
    (err, row) => {
      if (err || !row) return res.status(404).json({ error: "Фото не найдено" });
      if (Number(row.employee_id) !== Number(employeeId))
        return res.status(403).json({ error: "Нельзя удалить чужое фото" });
      db.run("DELETE FROM task_photos WHERE id = ?", [req.params.photoId], function (err2) {
        if (err2) return res.status(500).json({ error: "Ошибка БД" });
        if (row.photo_path && row.photo_path.startsWith("/uploads/")) {
          fs.unlink(path.join(__dirname, row.photo_path), () => {});
        }
        broadcast("tasks");
        res.json({ ok: true });
      });
    }
  );
});

// POST /api/tasks/:id/comments — добавить комментарий
app.post("/api/tasks/:id/comments", (req, res) => {
  const { author, comment } = req.body;
  if (!author || !comment || !comment.trim()) {
    return res.status(400).json({ error: "Автор и текст обязательны" });
  }
  db.get("SELECT status FROM tasks WHERE id = ?", [req.params.id], (err, task) => {
    if (err || !task) return res.status(404).json({ error: "Задание не найдено" });
    if (task.status === "done") return res.status(403).json({ error: "Нельзя добавлять комментарии к выполненному заданию" });
    const now = getTJDateTime();
    db.run(
      "INSERT INTO task_comments (task_id, author, comment, created_at) VALUES (?, ?, ?, ?)",
      [req.params.id, author.trim(), comment.trim(), now],
      function (err2) {
        if (err2) return res.status(500).json({ error: "Ошибка БД" });
        res.json({ id: this.lastID, task_id: Number(req.params.id), author: author.trim(), comment: comment.trim(), created_at: now });
      }
    );
  });
});



/* =====================================================
   =================   СТАТИЧЕСКИЕ ФАЙЛЫ   ==============
   ===================================================== */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Получить все смены
app.get("/api/shifts", (req, res) => {
  db.all("SELECT * FROM shifts", (err, rows) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json(rows || []);
  });
});

// Создать смену вручную (для редактора по дням)
app.post("/api/shifts", requireAdmin, (req, res) => {
  const { employee_id, start_time, end_time } = req.body;
  if (!employee_id || !start_time) return res.status(400).json({ error: "Не хватает данных" });
  const status = end_time ? "closed" : "open";
  db.run(
    "INSERT INTO shifts (employee_id, start_time, end_time, status) VALUES (?, ?, ?, ?)",
    [employee_id, start_time, end_time || null, status],
    function (err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      broadcast("employees");
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Обновить смену по id
app.patch("/api/shifts/:id", requireAdmin, (req, res) => {
  const shiftId = req.params.id;
  const { start_time, end_time } = req.body;
  if (!start_time) return res.status(400).json({ error: "start_time обязателен" });
  const status = end_time ? "closed" : "open";
  db.run(
    "UPDATE shifts SET start_time = ?, end_time = ?, status = ? WHERE id = ?",
    [start_time, end_time || null, status, shiftId],
    function (err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      broadcast("employees");
      res.json({ success: true });
    }
  );
});

// Удалить смену по id
app.delete("/api/shifts/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM shifts WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    broadcast("employees");
    res.json({ success: true });
  });
});









/* =====================================================
   =================   УВЕДОМЛЕНИЯ   ===================
   ===================================================== */

/* ── Авансы ── */
app.get("/api/advances", (_req, res) => {
  db.all(
    `SELECT a.*, e.name AS employee_name
     FROM advances a
     LEFT JOIN employees e ON e.id = a.employee_id
     ORDER BY a.date DESC, a.created_at DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json(rows || []);
    }
  );
});

app.post("/api/advances", requireAdmin, (req, res) => {
  const { employee_id, amount, date, comment } = req.body;
  if (!employee_id || !amount || !date) return res.status(400).json({ error: "Не все поля заполнены" });
  const created_at = new Date().toISOString();
  db.run(
    "INSERT INTO advances (employee_id, amount, date, comment, created_at) VALUES (?,?,?,?,?)",
    [employee_id, amount, date, comment || "", created_at],
    function(err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      broadcast("advances");
      res.json({ id: this.lastID });
    }
  );
});

app.patch("/api/advances/:id", requireAdmin, (req, res) => {
  const { employee_id, amount, date, comment } = req.body;
  if (!employee_id || !amount || !date) return res.status(400).json({ error: "Не все поля заполнены" });
  db.run(
    "UPDATE advances SET employee_id=?, amount=?, date=?, comment=? WHERE id=?",
    [employee_id, amount, date, comment || "", req.params.id],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      broadcast("advances");
      res.json({ ok: true });
    }
  );
});

app.delete("/api/advances/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM advances WHERE id = ?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    broadcast("advances");
    res.json({ ok: true });
  });
});

app.patch("/api/employees/:id/salary", requireAdmin, (req, res) => {
  const { salary } = req.body;
  if (salary === undefined || isNaN(Number(salary))) return res.status(400).json({ error: "Неверная сумма" });
  db.run("UPDATE employees SET salary = ? WHERE id = ?", [Number(salary), req.params.id], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    broadcast("employees");
    res.json({ ok: true });
  });
});

// Удалить сотрудника
app.delete("/api/employees/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  db.get("SELECT avatar FROM employees WHERE id = ?", [id], (_err, row) => {
    db.run("DELETE FROM employees WHERE id = ?", [id], err2 => {
      if (err2) return res.status(500).json({ error: "Ошибка БД" });
      if (row && row.avatar && row.avatar.startsWith("/uploads/")) {
        fs.unlink(path.join(__dirname, row.avatar), () => {});
      }
      broadcast("employees");
      res.json({ ok: true });
    });
  });
});

/* ── Зарплата: настройки (ставка + норма часов) ── */
app.get("/api/salary/settings", (req, res) => {
  const { year, month } = req.query;
  db.all(
    "SELECT * FROM salary_settings WHERE year = ? AND month = ?",
    [Number(year), Number(month)],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json(rows || []);
    }
  );
});

app.post("/api/salary/settings", requireAdmin, (req, res) => {
  const { employee_id, year, month, salary, norm_hours } = req.body;
  db.run(
    `INSERT INTO salary_settings (employee_id, year, month, salary, norm_hours)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, year, month) DO UPDATE SET
       salary     = excluded.salary,
       norm_hours = excluded.norm_hours`,
    [employee_id, year, month, salary || 0, norm_hours || 260],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ ok: true });
    }
  );
});

/* ── Зарплата: выплаты ── */
app.get("/api/salary/payments", (req, res) => {
  const { year, month } = req.query;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  db.all(
    `SELECT p.*, e.name AS employee_name
     FROM salary_payments p
     LEFT JOIN employees e ON e.id = p.employee_id
     WHERE p.date LIKE ?
     ORDER BY p.date DESC, p.created_at DESC`,
    [prefix + "%"],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json(rows || []);
    }
  );
});

app.post("/api/salary/payments", requireAdmin, (req, res) => {
  const { employee_id, amount, date, comment } = req.body;
  if (!employee_id || !amount || !date) return res.status(400).json({ error: "Не все поля заполнены" });
  const created_at = new Date().toISOString();
  db.run(
    "INSERT INTO salary_payments (employee_id, amount, date, comment, created_at) VALUES (?,?,?,?,?)",
    [employee_id, amount, date, comment || "", created_at],
    function(err) {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ id: this.lastID });
    }
  );
});

app.put("/api/salary/payments/:id", requireAdmin, (req, res) => {
  const { amount, comment } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: "Неверная сумма" });
  const id = req.params.id;
  db.get("SELECT amount FROM salary_payments WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Запись не найдена" });
    const oldAmount = row.amount;
    const changed_at = new Date().toISOString();
    db.run(
      "UPDATE salary_payments SET amount = ?, comment = ? WHERE id = ?",
      [Number(amount), comment || "", id],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Ошибка БД" });
        db.run(
          "INSERT INTO payment_logs (payment_id, old_amount, new_amount, changed_at) VALUES (?,?,?,?)",
          [id, oldAmount, Number(amount), changed_at],
          () => {} // лог: не блокируем ответ при ошибке
        );
        res.json({ ok: true, old_amount: oldAmount, new_amount: Number(amount), changed_at });
      }
    );
  });
});

app.patch("/api/salary/payments/:id", requireAdmin, (req, res) => {
  const { amount, comment } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: "Неверная сумма" });
  db.run(
    "UPDATE salary_payments SET amount = ?, comment = ? WHERE id = ?",
    [Number(amount), comment || "", req.params.id],
    err => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json({ ok: true });
    }
  );
});

app.delete("/api/salary/payments/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM salary_payments WHERE id = ?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json({ ok: true });
  });
});

// Получить уведомления (всегда с фильтром по дате)
app.get("/api/notifications", (req, res) => {
  let { date } = req.query;
  // Если дата не передана или имеет неверный формат — используем сегодняшнюю TJ-дату
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = getTJDateTime().substring(0, 10);
  }
  db.all(
    `SELECT n.*, e.name AS employee_name
     FROM notifications n
     LEFT JOIN employees e ON e.id = n.employee_id
     WHERE n.date = ?
     ORDER BY n.time DESC`,
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Ошибка БД" });
      res.json(rows || []);
    }
  );
});

// Пометить уведомление прочитанным
app.patch("/api/notifications/:id/read", requireAdmin, (req, res) => {
  db.run("UPDATE notifications SET status = 'read' WHERE id = ?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json({ success: true });
  });
});

// Удалить уведомление
app.delete("/api/notifications/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM notifications WHERE id = ?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    broadcast("notifications");
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log("✔ Backend Colorado запущен: http://localhost:" + PORT);
});

/* =====================================================
   ====  ПРОВЕРКА НЕЗАВЕРШЁННЫХ СМЕН (каждую мин)    ===
   ===================================================== */
setInterval(() => {
  const now     = getTJDateTime();
  const nowDate = now.substring(0, 10);
  const nowTime = now.substring(11, 16);

  if (nowTime < "19:20") return;

  db.all(
    `SELECT s.employee_id, e.name
     FROM shifts s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.status = 'open'
       AND s.start_time LIKE ?`,
    [nowDate + "%"],
    (err, rows) => {
      if (err || !rows || !rows.length) return;

      rows.forEach(row => {
        db.get(
          `SELECT id FROM notifications WHERE employee_id = ? AND date = ? AND notif_type = 'shift'`,
          [row.employee_id, nowDate],
          (_err2, existing) => {
            if (existing) return;

            db.all(
              `SELECT t.title FROM tasks t
               JOIN task_assigned ta ON ta.task_id = t.id
               WHERE ta.employee_id = ? AND t.status != 'done' AND t.date = ?`,
              [row.employee_id, nowDate],
              (_err3, tasks) => {
                const taskInfo = (tasks && tasks.length)
                  ? `${tasks.length}|${tasks.map(t => t.title).join(", ")}`
                  : null;

                db.run(
                  `INSERT INTO notifications (employee_id, date, time, message, status, task_title, notif_type)
                   VALUES (?, ?, ?, ?, 'unread', ?, 'shift')`,
                  [row.employee_id, nowDate, nowTime,
                   `Сотрудник ${row.name} не завершил смену`,
                   taskInfo]
                );
                broadcast("notifications");
                console.log(`⚠ Смена не завершена: ${row.name}`);
              }
            );
          }
        );
      });
    }
  );
}, 60 * 1000);

/* =====================================================
   ====  ПРОВЕРКА ПРОСРОЧЕННЫХ ЗАДАНИЙ (каждую мин)  ===
   ===================================================== */
setInterval(() => {
  const now     = getTJDateTime();
  const nowDate = now.substring(0, 10);
  const nowTime = now.substring(11, 16);

  db.all(
    `SELECT t.id, t.title, t.due_time, t.date
     FROM tasks t
     WHERE t.status != 'done'
       AND t.overdue_notified = 0
       AND t.due_time IS NOT NULL AND t.due_time != ''
       AND (t.date < ? OR (t.date = ? AND t.due_time <= ?))`,
    [nowDate, nowDate, nowTime],
    (err, rows) => {
      if (err || !rows || !rows.length) return;

      rows.forEach(task => {
        // Получаем имена главных и участников одним запросом
        db.all(
          `SELECT e.name, 'assigned' AS role
           FROM task_assigned ta JOIN employees e ON e.id = ta.employee_id
           WHERE ta.task_id = ?
           UNION ALL
           SELECT e.name, 'participant' AS role
           FROM task_participants tp JOIN employees e ON e.id = tp.employee_id
           WHERE tp.task_id = ?`,
          [task.id, task.id],
          (_err2, people) => {
            const assigned     = (people || []).filter(p => p.role === "assigned").map(p => p.name);
            const participants = (people || []).filter(p => p.role === "participant").map(p => p.name);
            const taskExtra    = JSON.stringify({ assigned, participants });

            db.run(
              `INSERT INTO notifications
                 (employee_id, date, time, message, status, task_title, task_due_time, notif_type, task_extra)
               VALUES (NULL, ?, ?, ?, 'unread', ?, ?, 'task_deadline', ?)`,
              [nowDate, nowTime,
               `Задание «${task.title}» не выполнено в срок`,
               task.title, task.due_time, taskExtra],
              (insertErr) => {
                if (insertErr) { console.error("Ошибка вставки уведомления:", insertErr.message); return; }
                db.run(`UPDATE tasks SET overdue_notified = 1 WHERE id = ?`, [task.id]);
                broadcast("notifications");
                console.log(`⚠ Просрочено задание #${task.id}: «${task.title}»`);
              }
            );
          }
        );
      });
    }
  );
}, 60 * 1000);



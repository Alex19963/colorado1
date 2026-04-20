require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");
const multer  = require("multer");
const crypto  = require("crypto");
const pool    = require("./db");

// ====================== TJ TIME (UTC+5) ======================
function getTJDateTime() {
  const now  = new Date();
  const tj   = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const Y    = tj.getUTCFullYear();
  const M    = String(tj.getUTCMonth() + 1).padStart(2, "0");
  const D    = String(tj.getUTCDate()).padStart(2, "0");
  const h    = String(tj.getUTCHours()).padStart(2, "0");
  const m    = String(tj.getUTCMinutes()).padStart(2, "0");
  const s    = String(tj.getUTCSeconds()).padStart(2, "0");
  return `${Y}-${M}-${D}T${h}:${m}:${s}`;
}
// ============================================================

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ── Multer: MIME whitelist ── */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
function imageFileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Разрешены только изображения (jpeg, png, gif, webp)"), false);
}

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

const storageTask = multer.diskStorage({
  destination: (req, file, cb) => {
    const today = getTJDateTime().substring(0, 10);
    const dir   = path.join(__dirname, "uploads", "tasks", today);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext);
  }
});
const uploadTask = multer({ storage: storageTask, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFileFilter });

/* ── Инициализация БД ── */
async function initDB(attempt = 1) {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");
    await pool.query(sql);

    const { rows } = await pool.query("SELECT id FROM admin LIMIT 1");
    if (rows.length === 0) {
      const token = crypto.randomBytes(32).toString("hex");
      await pool.query(
        "INSERT INTO admin (login, password, token) VALUES ($1, $2, $3)",
        ["admin", "admin", token]
      );
      console.log("✔ Администратор создан: admin / admin");
      console.log("✔ TOKEN:", token);
    }
    console.log("✔ База данных инициализирована");
  } catch (err) {
    console.error(`❌ Ошибка подключения к БД (попытка ${attempt}): ${err.message}`);
    if (attempt < 5) {
      console.log(`   Повтор через 3 сек...`);
      setTimeout(() => initDB(attempt + 1), 3000);
    } else {
      console.error("❌ Не удалось подключиться к PostgreSQL. Проверьте DATABASE_URL.");
      process.exit(1);
    }
  }
}
initDB();

/* ─── SSE ─── */
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
  res.setHeader("Content-Type",       "text/event-stream");
  res.setHeader("Cache-Control",      "no-cache");
  res.setHeader("Connection",         "keep-alive");
  res.setHeader("X-Accel-Buffering",  "no");
  res.flushHeaders();
  res.write(":connected\n\n");
  sseClients.add(res);
  const keepAlive = setInterval(() => { try { res.write(":ping\n\n"); } catch { clearInterval(keepAlive); } }, 25000);
  req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
});

/* =====================================================
   =================   АВТОРИЗАЦИЯ   ====================
   ===================================================== */

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip        = req.ip || req.connection.remoteAddress || "unknown";
  const now       = Date.now();
  const windowMs  = 60 * 1000;
  const maxAttempts = 10;
  const entry     = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  loginAttempts.set(ip, entry);
  if (entry.count > maxAttempts)
    return res.status(429).json({ error: "Слишком много попыток. Подождите минуту." });
  next();
}

app.post("/api/admin/login", loginRateLimit, async (req, res) => {
  const { login, password } = req.body;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM admin WHERE login = $1 AND password = $2",
      [login, password]
    );
    if (!rows.length) return res.status(401).json({ error: "Неверные данные" });
    res.json({ token: rows[0].token });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/employees/login", loginRateLimit, async (req, res) => {
  const { password } = req.body;
  if (!password || !password.trim()) return res.status(400).json({ error: "Введите пароль" });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, avatar, "activeStart", "lastEnd", salary
       FROM employees WHERE password = $1 LIMIT 1`,
      [password.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: "Неверный пароль" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.get("/api/admin/verify", async (req, res) => {
  const token = req.headers["x-admin-token"] || req.query.token || "";
  if (!token) return res.status(401).json({ ok: false });
  try {
    const { rows } = await pool.query("SELECT id FROM admin WHERE token = $1", [token.trim()]);
    if (!rows.length) return res.status(401).json({ ok: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ ok: false });
  }
});

async function requireAdmin(req, res, next) {
  const token = (req.headers["x-admin-token"] || req.query.token || "").trim();
  if (!token) return res.status(401).json({ error: "Требуется авторизация" });
  try {
    const { rows } = await pool.query("SELECT id FROM admin WHERE token = $1", [token]);
    if (!rows.length) return res.status(401).json({ error: "Неверный токен" });
    next();
  } catch (e) {
    res.status(401).json({ error: "Неверный токен" });
  }
}

/* =====================================================
   =================   АДМИН-АККАУНТ   =================
   ===================================================== */

const activeSessions = new Map();

app.post("/api/admin/heartbeat", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  activeSessions.set(sessionId, Date.now());
  res.json({ ok: true });
});

app.get("/api/admin/online", (req, res) => {
  const threshold = Date.now() - 60 * 1000;
  let count = 0;
  for (const [id, ts] of activeSessions) {
    if (ts > threshold) count++;
    else activeSessions.delete(id);
  }
  res.json({ count });
});

app.get("/api/admin/info", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT login FROM admin LIMIT 1");
    if (!rows.length) return res.status(500).json({ error: "Ошибка БД" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/admin/login", requireAdmin, async (req, res) => {
  const login = String(req.body.login || "").trim();
  if (!login) return res.status(400).json({ error: "Логин не может быть пустым" });
  try {
    await pool.query("UPDATE admin SET login = $1 WHERE id = 1", [login]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/admin/password", requireAdmin, async (req, res) => {
  const password = String(req.body.password || "").trim();
  if (!password) return res.status(400).json({ error: "Пароль не может быть пустым" });
  try {
    await pool.query("UPDATE admin SET password = $1 WHERE id = 1", [password]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   ЗАГРУЗКА ФАЙЛОВ   ================
   ===================================================== */

app.post("/api/upload/avatar", requireAdmin, uploadEmployee.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Нет файла" });
  res.json({ url: "/uploads/employees/" + req.file.filename });
});

app.post("/api/upload/task-photo", uploadTask.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Нет файла" });
  const today = getTJDateTime().substring(0, 10);
  res.json({ url: "/uploads/tasks/" + today + "/" + req.file.filename });
});

/* =====================================================
   =================   СОТРУДНИКИ   =====================
   ===================================================== */

app.get("/api/employees", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, avatar, "activeStart", "lastEnd", salary, password FROM employees`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.get("/api/employees/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, avatar, "activeStart", "lastEnd", salary, password FROM employees WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Сотрудник не найден" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/employees", requireAdmin, async (req, res) => {
  let { name, password, avatar } = req.body;
  name     = String(name     || "").trim();
  password = String(password || "").trim();
  avatar   = String(avatar   || "").trim();

  if (!name || !password)
    return res.status(400).json({ error: "Требуются поля name и password" });
  if (!/^\d{4,}$/.test(password))
    return res.status(400).json({ error: "Пароль должен содержать минимум 4 цифры (только цифры 0–9)" });

  try {
    const nameCheck = await pool.query("SELECT id FROM employees WHERE name = $1 LIMIT 1", [name]);
    if (nameCheck.rows.length)
      return res.status(409).json({ error: "Сотрудник с таким именем уже существует" });

    const passCheck = await pool.query("SELECT id FROM employees WHERE password = $1 LIMIT 1", [password]);
    if (passCheck.rows.length)
      return res.status(409).json({ error: "Пароль уже используется другим сотрудником" });

    const { rows } = await pool.query(
      `INSERT INTO employees (name, password, avatar, "activeStart", "lastEnd")
       VALUES ($1, $2, $3, NULL, NULL) RETURNING id`,
      [name, password, avatar || null]
    );
    broadcast("employees");
    res.json({ id: rows[0].id, message: "Сотрудник успешно добавлен" });
  } catch (e) {
    res.status(500).json({ error: "Ошибка при добавлении сотрудника" });
  }
});

app.get("/api/employees/:id/shifts", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM shifts WHERE employee_id = $1 ORDER BY id DESC",
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/employees/:id", requireAdmin, async (req, res) => {
  const id          = req.params.id;
  const { name, avatar, password } = req.body;
  const trimmedName = String(name || "").trim();
  if (!trimmedName) return res.status(400).json({ error: "Имя не может быть пустым" });

  const fields = ["name = $1"];
  const values = [trimmedName];
  let   idx    = 2;

  if (avatar !== undefined) { fields.push(`avatar = $${idx++}`); values.push(avatar || null); }
  if (password !== undefined && String(password).trim()) {
    const trimmedPwd = String(password).trim();
    if (!/^\d{4,}$/.test(trimmedPwd))
      return res.status(400).json({ error: "Пароль должен содержать минимум 4 цифры (только цифры 0–9)" });
    fields.push(`password = $${idx++}`);
    values.push(trimmedPwd);
  }
  values.push(id);

  try {
    let oldAvatar = null;
    if (avatar !== undefined) {
      const { rows } = await pool.query("SELECT avatar FROM employees WHERE id = $1", [id]);
      if (rows.length) oldAvatar = rows[0].avatar;
    }

    await pool.query(`UPDATE employees SET ${fields.join(", ")} WHERE id = $${idx}`, values);

    if (oldAvatar && oldAvatar.startsWith("/uploads/")) {
      fs.unlink(path.join(__dirname, oldAvatar), () => {});
    }
    broadcast("employees");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/employees/:id/complete-tasks", requireAdmin, async (req, res) => {
  const empId = req.params.id;
  try {
    const result = await pool.query(
      `UPDATE tasks SET status = 'done'
       WHERE status != 'done'
         AND id IN (
           SELECT task_id FROM task_assigned    WHERE employee_id = $1
           UNION
           SELECT task_id FROM task_participants WHERE employee_id = $1
         )`,
      [empId]
    );
    broadcast("tasks");
    broadcast("employees");
    res.json({ ok: true, updated: result.rowCount });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/employees/:id/start", async (req, res) => {
  const id       = req.params.id;
  const localISO = getTJDateTime();
  try {
    const { rows } = await pool.query(
      "SELECT * FROM shifts WHERE employee_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1",
      [id]
    );
    if (rows.length) {
      console.log(`⚠️ Смена уже открыта для сотрудника #${id}`);
      return res.json({ success: true, start: rows[0].start_time });
    }
    await pool.query(
      "INSERT INTO shifts (employee_id, start_time, status) VALUES ($1, $2, 'open')",
      [id, localISO]
    );
    console.log(`▶️ Смена начата для #${id} в ${localISO}`);
    broadcast("employees");
    res.json({ success: true, start: localISO });
  } catch (e) {
    console.error("Ошибка создания смены:", e);
    res.status(500).json({ error: "Ошибка при создании смены" });
  }
});

app.patch("/api/employees/:id/stop", async (req, res) => {
  const id       = req.params.id;
  const localISO = getTJDateTime();

  async function closeShift(shiftId) {
    await pool.query(
      "UPDATE shifts SET end_time = $1, status = 'closed' WHERE id = $2",
      [localISO, shiftId]
    );
    console.log(`⏹ Смена #${shiftId} завершена для сотрудника #${id}`);
    broadcast("employees");
    const { rows } = await pool.query("SELECT * FROM shifts WHERE id = $1", [shiftId]);
    const row      = rows[0];
    res.json({ success: true, lastShift: row, lastEnd: row.end_time, lastStatus: row.status });
  }

  try {
    const open = await pool.query(
      "SELECT id FROM shifts WHERE employee_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1",
      [id]
    );
    if (open.rows.length) return closeShift(open.rows[0].id);

    const pending = await pool.query(
      "SELECT id FROM shifts WHERE employee_id = $1 AND (end_time IS NULL OR end_time = '') ORDER BY id DESC LIMIT 1",
      [id]
    );
    if (!pending.rows.length) {
      console.warn(`❗ Нет открытой смены у #${id}`);
      return res.status(400).json({ error: "Нет открытой смены" });
    }
    closeShift(pending.rows[0].id);
  } catch (e) {
    console.error("Ошибка завершения смены:", e);
    res.status(500).json({ error: "Ошибка при завершении смены" });
  }
});

app.patch("/api/employees/:id/salary", requireAdmin, async (req, res) => {
  const { salary } = req.body;
  if (salary === undefined || isNaN(Number(salary)))
    return res.status(400).json({ error: "Неверная сумма" });
  try {
    await pool.query("UPDATE employees SET salary = $1 WHERE id = $2", [Number(salary), req.params.id]);
    broadcast("employees");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/employees/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await pool.query("SELECT avatar FROM employees WHERE id = $1", [id]);
    await pool.query("DELETE FROM employees WHERE id = $1", [id]);
    if (rows.length && rows[0].avatar && rows[0].avatar.startsWith("/uploads/")) {
      fs.unlink(path.join(__dirname, rows[0].avatar), () => {});
    }
    broadcast("employees");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   ЗАДАНИЯ   ========================
   ===================================================== */

app.post("/api/tasks", requireAdmin, async (req, res) => {
  const { date, title, description, type, assignedEmployees = [], due_time, time_from, mainEmployeeId } = req.body;
  const createdAt = getTJDateTime();
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (date, title, description, type, created_at, due_time, time_from, main_employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [date, title || "", description || "", type, createdAt, due_time || null, time_from || null, mainEmployeeId || null]
    );
    const taskId = rows[0].id;

    if (Array.isArray(assignedEmployees) && assignedEmployees.length > 0) {
      for (const empId of assignedEmployees) {
        await pool.query("INSERT INTO task_assigned    (task_id, employee_id) VALUES ($1, $2)", [taskId, empId]);
        await pool.query("INSERT INTO task_participants (task_id, employee_id) VALUES ($1, $2)", [taskId, empId]);
      }
    }

    broadcast("tasks");
    res.status(201).json({ id: taskId, assignedEmployees, message: "Задание успешно добавлено" });
  } catch (e) {
    console.error("Ошибка при добавлении задания:", e);
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/tasks/:id/join", async (req, res) => {
  const { employee_id } = req.body;
  try {
    await pool.query("INSERT INTO task_participants (task_id, employee_id) VALUES ($1, $2)", [req.params.id, employee_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/tasks/:id/leave", async (req, res) => {
  const { employee_id } = req.body;
  try {
    await pool.query("DELETE FROM task_participants WHERE task_id = $1 AND employee_id = $2", [req.params.id, employee_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/tasks/:id/toggle", requireAdmin, async (req, res) => {
  const taskId = req.params.id;
  try {
    const taskRes = await pool.query("SELECT status FROM tasks WHERE id = $1", [taskId]);
    if (!taskRes.rows.length) return res.status(404).json({ error: "Задание не найдено" });

    const empRes = await pool.query(
      `SELECT employee_id FROM task_assigned    WHERE task_id = $1
       UNION
       SELECT employee_id FROM task_participants WHERE task_id = $1`,
      [taskId]
    );
    if (!empRes.rows.length)
      return res.status(400).json({ error: "Нельзя завершить задание без выбранных сотрудников" });

    const nextStatus  = taskRes.rows[0].status === "done" ? "in_progress" : "done";
    const completedAt = nextStatus === "done" ? getTJDateTime() : null;
    await pool.query("UPDATE tasks SET status = $1, completed_at = $2 WHERE id = $3", [nextStatus, completedAt, taskId]);
    broadcast("tasks");
    res.json({ status: nextStatus });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/tasks/:id/complete-by-employee", async (req, res) => {
  const taskId     = Number(req.params.id);
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId обязателен" });
  try {
    const { rows } = await pool.query("SELECT id, status, main_employee_id FROM tasks WHERE id = $1", [taskId]);
    if (!rows.length) return res.status(404).json({ error: "Задание не найдено" });
    if (rows[0].main_employee_id !== Number(employeeId))
      return res.status(403).json({ error: "Только главный сотрудник может изменить статус" });

    const nextStatus  = rows[0].status === "done" ? "in_progress" : "done";
    const completedAt = nextStatus === "done" ? getTJDateTime() : null;
    await pool.query("UPDATE tasks SET status = $1, completed_at = $2 WHERE id = $3", [nextStatus, completedAt, taskId]);
    broadcast("tasks");
    res.json({ status: nextStatus });
  } catch (e) {
    res.status(500).json({ error: "Ошибка обновления статуса" });
  }
});

app.patch("/api/tasks/:id/rating", requireAdmin, async (req, res) => {
  const { rating } = req.body;
  const taskId     = Number(req.params.id);
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Рейтинг 1–5" });
  try {
    await pool.query("UPDATE tasks SET rating = $1 WHERE id = $2", [rating, taskId]);
    broadcast("tasks");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/tasks/:id/completion_day", requireAdmin, async (req, res) => {
  const { completion_day } = req.body;
  try {
    await pool.query("UPDATE tasks SET completion_day = $1 WHERE id = $2", [completion_day || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/tasks/:id", requireAdmin, async (req, res) => {
  const { date, title, description, assignedEmployees = [], due_time, time_from, mainEmployeeId } = req.body;
  const id = req.params.id;
  try {
    await pool.query(
      `UPDATE tasks SET date=$1, title=$2, description=$3, due_time=$4,
       time_from=$5, main_employee_id=$6, overdue_notified=0 WHERE id=$7`,
      [date, title || "", description || "", due_time || null, time_from || null, mainEmployeeId || null, id]
    );

    await pool.query("DELETE FROM task_assigned WHERE task_id = $1", [id]);
    for (const empId of assignedEmployees) {
      await pool.query("INSERT INTO task_assigned (task_id, employee_id) VALUES ($1, $2)", [id, empId]);
    }

    const { rows: currentParts } = await pool.query(
      "SELECT employee_id FROM task_participants WHERE task_id = $1", [id]
    );
    const currentIds = currentParts.map(r => r.employee_id);
    const toRemove   = currentIds.filter(eid => !assignedEmployees.includes(eid));
    for (const empId of toRemove) {
      await pool.query("DELETE FROM task_participants WHERE task_id = $1 AND employee_id = $2", [id, empId]);
    }
    for (const empId of assignedEmployees) {
      const exists = await pool.query(
        "SELECT id FROM task_participants WHERE task_id = $1 AND employee_id = $2", [id, empId]
      );
      if (!exists.rows.length) {
        await pool.query("INSERT INTO task_participants (task_id, employee_id) VALUES ($1, $2)", [id, empId]);
      }
    }

    broadcast("tasks");
    res.json({ success: true, assignedEmployees });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД при обновлении задания" });
  }
});

app.delete("/api/tasks/:id", requireAdmin, async (req, res) => {
  const id     = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM task_assigned     WHERE task_id = $1", [id]);
    await client.query("DELETE FROM task_participants WHERE task_id = $1", [id]);
    await client.query("DELETE FROM tasks             WHERE id = $1",      [id]);
    await client.query("COMMIT");
    broadcast("tasks");
    res.json({ success: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Ошибка БД" });
  } finally {
    client.release();
  }
});

app.get("/api/tasks", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.*,
             STRING_AGG(DISTINCT ta.employee_id::text, ',') AS assigned_ids,
             STRING_AGG(DISTINCT tp.employee_id::text, ',') AS participant_ids,
             COUNT(DISTINCT tph.id)                         AS photo_count
      FROM tasks t
      LEFT JOIN task_assigned     ta  ON ta.task_id  = t.id
      LEFT JOIN task_participants tp  ON tp.task_id  = t.id
      LEFT JOIN task_photos       tph ON tph.task_id = t.id
      GROUP BY t.id
      ORDER BY t.date DESC
    `);
    const result = rows.map(r => {
      const { assigned_ids, participant_ids, ...rest } = r;
      return {
        ...rest,
        assignedEmployees: assigned_ids  ? assigned_ids.split(",").map(Number)  : [],
        participants:      participant_ids ? participant_ids.split(",").map(Number) : [],
        photoCount: Number(rest.photo_count) || 0
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.get("/api/tasks/:id/photos", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tp.id, tp.task_id, tp.employee_id, tp.photo_data, tp.photo_path, tp.created_at,
              e.name AS employee_name
       FROM task_photos tp
       LEFT JOIN employees e ON e.id = tp.employee_id
       WHERE tp.task_id = $1
       ORDER BY tp.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/tasks/:id/photos", async (req, res) => {
  const taskId = req.params.id;
  const { photoData, photo_path, employeeId } = req.body;
  if (!photoData && !photo_path) return res.status(400).json({ error: "Нет данных фото" });
  try {
    const taskRes = await pool.query("SELECT status FROM tasks WHERE id = $1", [taskId]);
    if (!taskRes.rows.length) return res.status(404).json({ error: "Задание не найдено" });
    if (taskRes.rows[0].status === "done")
      return res.status(403).json({ error: "Нельзя добавлять фото к выполненному заданию" });

    const createdAt = getTJDateTime();
    const { rows } = await pool.query(
      `INSERT INTO task_photos (task_id, employee_id, photo_data, photo_path, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [taskId, employeeId || null, photoData || "", photo_path || null, createdAt]
    );
    broadcast("tasks");
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/tasks/photos/:photoId", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT photo_path FROM task_photos WHERE id = $1", [req.params.photoId]);
    await pool.query("DELETE FROM task_photos WHERE id = $1", [req.params.photoId]);
    if (rows.length && rows[0].photo_path && rows[0].photo_path.startsWith("/uploads/")) {
      fs.unlink(path.join(__dirname, rows[0].photo_path), () => {});
    }
    broadcast("tasks");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/tasks/photos/:photoId/by-employee", async (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error: "employeeId обязателен" });
  try {
    const { rows } = await pool.query(
      "SELECT id, employee_id, photo_path FROM task_photos WHERE id = $1",
      [req.params.photoId]
    );
    if (!rows.length) return res.status(404).json({ error: "Фото не найдено" });
    if (Number(rows[0].employee_id) !== Number(employeeId))
      return res.status(403).json({ error: "Нельзя удалить чужое фото" });
    await pool.query("DELETE FROM task_photos WHERE id = $1", [req.params.photoId]);
    if (rows[0].photo_path && rows[0].photo_path.startsWith("/uploads/")) {
      fs.unlink(path.join(__dirname, rows[0].photo_path), () => {});
    }
    broadcast("tasks");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* ── Комментарии ── */

app.get("/api/tasks/:id/comments", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/tasks/:id/comments", async (req, res) => {
  const { author, comment } = req.body;
  if (!author || !comment || !comment.trim())
    return res.status(400).json({ error: "Автор и текст обязательны" });
  try {
    const taskRes = await pool.query("SELECT status FROM tasks WHERE id = $1", [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: "Задание не найдено" });
    if (taskRes.rows[0].status === "done")
      return res.status(403).json({ error: "Нельзя добавлять комментарии к выполненному заданию" });

    const now = getTJDateTime();
    const { rows } = await pool.query(
      "INSERT INTO task_comments (task_id, author, comment, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [req.params.id, author.trim(), comment.trim(), now]
    );
    res.json({ id: rows[0].id, task_id: Number(req.params.id), author: author.trim(), comment: comment.trim(), created_at: now });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/tasks/:id/comments/:cid", requireAdmin, async (req, res) => {
  const { comment } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: "Пустой комментарий" });
  try {
    const result = await pool.query(
      "UPDATE task_comments SET comment = $1 WHERE id = $2 AND task_id = $3",
      [comment.trim(), req.params.cid, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Не найдено" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/tasks/:id/comments/:cid", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM task_comments WHERE id = $1 AND task_id = $2", [req.params.cid, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/tasks/:id/comments/:cid/by-employee", async (req, res) => {
  const { comment, employeeName } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: "Пустой комментарий" });
  if (!employeeName)               return res.status(400).json({ error: "employeeName обязателен" });
  try {
    const { rows } = await pool.query(
      "SELECT id, author FROM task_comments WHERE id = $1 AND task_id = $2",
      [req.params.cid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Комментарий не найден" });
    if (rows[0].author !== employeeName.trim())
      return res.status(403).json({ error: "Нельзя редактировать чужой комментарий" });
    await pool.query("UPDATE task_comments SET comment = $1 WHERE id = $2", [comment.trim(), req.params.cid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/tasks/:id/comments/:cid/by-employee", async (req, res) => {
  const { employeeName } = req.body;
  if (!employeeName) return res.status(400).json({ error: "employeeName обязателен" });
  try {
    const { rows } = await pool.query(
      "SELECT id, author FROM task_comments WHERE id = $1 AND task_id = $2",
      [req.params.cid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Комментарий не найден" });
    if (rows[0].author !== employeeName.trim())
      return res.status(403).json({ error: "Нельзя удалить чужой комментарий" });
    await pool.query("DELETE FROM task_comments WHERE id = $1", [req.params.cid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   СТАТИКА   ========================
   ===================================================== */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

/* =====================================================
   =================   СМЕНЫ   ==========================
   ===================================================== */

app.get("/api/shifts", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM shifts");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/shifts", requireAdmin, async (req, res) => {
  const { employee_id, start_time, end_time } = req.body;
  if (!employee_id || !start_time) return res.status(400).json({ error: "Не хватает данных" });
  const status = end_time ? "closed" : "open";
  try {
    const { rows } = await pool.query(
      "INSERT INTO shifts (employee_id, start_time, end_time, status) VALUES ($1, $2, $3, $4) RETURNING id",
      [employee_id, start_time, end_time || null, status]
    );
    broadcast("employees");
    res.json({ success: true, id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/shifts/:id", requireAdmin, async (req, res) => {
  const { start_time, end_time } = req.body;
  if (!start_time) return res.status(400).json({ error: "start_time обязателен" });
  const status = end_time ? "closed" : "open";
  try {
    await pool.query(
      "UPDATE shifts SET start_time = $1, end_time = $2, status = $3 WHERE id = $4",
      [start_time, end_time || null, status, req.params.id]
    );
    broadcast("employees");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/shifts/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM shifts WHERE id = $1", [req.params.id]);
    broadcast("employees");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   АВАНСЫ   =========================
   ===================================================== */

app.get("/api/advances", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, e.name AS employee_name
       FROM advances a
       LEFT JOIN employees e ON e.id = a.employee_id
       ORDER BY a.date DESC, a.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/advances", requireAdmin, async (req, res) => {
  const { employee_id, amount, date, comment } = req.body;
  if (!employee_id || !amount || !date) return res.status(400).json({ error: "Не все поля заполнены" });
  const created_at = new Date().toISOString();
  try {
    const { rows } = await pool.query(
      "INSERT INTO advances (employee_id, amount, date, comment, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [employee_id, amount, date, comment || "", created_at]
    );
    broadcast("advances");
    res.json({ id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/advances/:id", requireAdmin, async (req, res) => {
  const { employee_id, amount, date, comment } = req.body;
  if (!employee_id || !amount || !date) return res.status(400).json({ error: "Не все поля заполнены" });
  try {
    await pool.query(
      "UPDATE advances SET employee_id=$1, amount=$2, date=$3, comment=$4 WHERE id=$5",
      [employee_id, amount, date, comment || "", req.params.id]
    );
    broadcast("advances");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/advances/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM advances WHERE id = $1", [req.params.id]);
    broadcast("advances");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   ЗАРПЛАТА   =======================
   ===================================================== */

app.get("/api/salary/settings", async (req, res) => {
  const { year, month } = req.query;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM salary_settings WHERE year = $1 AND month = $2",
      [Number(year), Number(month)]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/salary/settings", requireAdmin, async (req, res) => {
  const { employee_id, year, month, salary, norm_hours } = req.body;
  try {
    await pool.query(
      `INSERT INTO salary_settings (employee_id, year, month, salary, norm_hours)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(employee_id, year, month) DO UPDATE SET
         salary     = EXCLUDED.salary,
         norm_hours = EXCLUDED.norm_hours`,
      [employee_id, year, month, salary || 0, norm_hours || 260]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.get("/api/salary/payments", async (req, res) => {
  const { year, month } = req.query;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  try {
    const { rows } = await pool.query(
      `SELECT p.*, e.name AS employee_name
       FROM salary_payments p
       LEFT JOIN employees e ON e.id = p.employee_id
       WHERE p.date LIKE $1
       ORDER BY p.date DESC, p.created_at DESC`,
      [prefix + "%"]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.post("/api/salary/payments", requireAdmin, async (req, res) => {
  const { employee_id, amount, date, comment } = req.body;
  if (!employee_id || !amount || !date) return res.status(400).json({ error: "Не все поля заполнены" });
  const created_at = new Date().toISOString();
  try {
    const { rows } = await pool.query(
      "INSERT INTO salary_payments (employee_id, amount, date, comment, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [employee_id, amount, date, comment || "", created_at]
    );
    res.json({ id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.put("/api/salary/payments/:id", requireAdmin, async (req, res) => {
  const { amount, comment } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: "Неверная сумма" });
  const id = req.params.id;
  try {
    const { rows } = await pool.query("SELECT amount FROM salary_payments WHERE id = $1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
    const oldAmount  = rows[0].amount;
    const changed_at = new Date().toISOString();
    await pool.query("UPDATE salary_payments SET amount = $1, comment = $2 WHERE id = $3", [Number(amount), comment || "", id]);
    pool.query(
      "INSERT INTO payment_logs (payment_id, old_amount, new_amount, changed_at) VALUES ($1,$2,$3,$4)",
      [id, oldAmount, Number(amount), changed_at]
    ).catch(() => {});
    res.json({ ok: true, old_amount: oldAmount, new_amount: Number(amount), changed_at });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/salary/payments/:id", requireAdmin, async (req, res) => {
  const { amount, comment } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: "Неверная сумма" });
  try {
    await pool.query(
      "UPDATE salary_payments SET amount = $1, comment = $2 WHERE id = $3",
      [Number(amount), comment || "", req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/salary/payments/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM salary_payments WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   УВЕДОМЛЕНИЯ   ===================
   ===================================================== */

app.get("/api/notifications", async (req, res) => {
  let { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = getTJDateTime().substring(0, 10);
  }
  try {
    const { rows } = await pool.query(
      `SELECT n.*, e.name AS employee_name
       FROM notifications n
       LEFT JOIN employees e ON e.id = n.employee_id
       WHERE n.date = $1
       ORDER BY n.time DESC`,
      [date]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.patch("/api/notifications/:id/read", requireAdmin, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET status = 'read' WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

app.delete("/api/notifications/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM notifications WHERE id = $1", [req.params.id]);
    broadcast("notifications");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка БД" });
  }
});

/* =====================================================
   =================   ЗАПУСК СЕРВЕРА   =================
   ===================================================== */

app.listen(PORT, () => {
  console.log("✔ Backend Colorado запущен: http://localhost:" + PORT);
});

/* =====================================================
   ====  ПРОВЕРКА НЕЗАВЕРШЁННЫХ СМЕН (каждую мин)    ===
   ===================================================== */
setInterval(async () => {
  const now     = getTJDateTime();
  const nowDate = now.substring(0, 10);
  const nowTime = now.substring(11, 16);
  if (nowTime < "19:20") return;
  try {
    const { rows } = await pool.query(
      `SELECT s.employee_id, e.name
       FROM shifts s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.status = 'open'
         AND s.start_time LIKE $1`,
      [nowDate + "%"]
    );
    for (const row of rows) {
      const existing = await pool.query(
        `SELECT id FROM notifications WHERE employee_id = $1 AND date = $2 AND notif_type = 'shift'`,
        [row.employee_id, nowDate]
      );
      if (existing.rows.length) continue;

      const taskRes = await pool.query(
        `SELECT t.title FROM tasks t
         JOIN task_assigned ta ON ta.task_id = t.id
         WHERE ta.employee_id = $1 AND t.status != 'done' AND t.date = $2`,
        [row.employee_id, nowDate]
      );
      const tasks    = taskRes.rows;
      const taskInfo = tasks.length
        ? `${tasks.length}|${tasks.map(t => t.title).join(", ")}`
        : null;

      await pool.query(
        `INSERT INTO notifications (employee_id, date, time, message, status, task_title, notif_type)
         VALUES ($1, $2, $3, $4, 'unread', $5, 'shift')`,
        [row.employee_id, nowDate, nowTime, `Сотрудник ${row.name} не завершил смену`, taskInfo]
      );
      broadcast("notifications");
      console.log(`⚠ Смена не завершена: ${row.name}`);
    }
  } catch (e) {
    console.error("Ошибка проверки смен:", e.message);
  }
}, 60 * 1000);

/* =====================================================
   ====  ПРОВЕРКА ПРОСРОЧЕННЫХ ЗАДАНИЙ (каждую мин)  ===
   ===================================================== */
setInterval(async () => {
  const now     = getTJDateTime();
  const nowDate = now.substring(0, 10);
  const nowTime = now.substring(11, 16);
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.due_time, t.date
       FROM tasks t
       WHERE t.status != 'done'
         AND t.overdue_notified = 0
         AND t.due_time IS NOT NULL AND t.due_time != ''
         AND (t.date < $1 OR (t.date = $1 AND t.due_time <= $2))`,
      [nowDate, nowTime]
    );
    for (const task of rows) {
      const peopleRes = await pool.query(
        `SELECT e.name, 'assigned' AS role
         FROM task_assigned ta JOIN employees e ON e.id = ta.employee_id
         WHERE ta.task_id = $1
         UNION ALL
         SELECT e.name, 'participant' AS role
         FROM task_participants tp JOIN employees e ON e.id = tp.employee_id
         WHERE tp.task_id = $1`,
        [task.id]
      );
      const people       = peopleRes.rows;
      const assigned     = people.filter(p => p.role === "assigned").map(p => p.name);
      const participants = people.filter(p => p.role === "participant").map(p => p.name);
      const taskExtra    = JSON.stringify({ assigned, participants });

      await pool.query(
        `INSERT INTO notifications
           (employee_id, date, time, message, status, task_title, task_due_time, notif_type, task_extra)
         VALUES (NULL, $1, $2, $3, 'unread', $4, $5, 'task_deadline', $6)`,
        [nowDate, nowTime, `Задание «${task.title}» не выполнено в срок`, task.title, task.due_time, taskExtra]
      );
      await pool.query(`UPDATE tasks SET overdue_notified = 1 WHERE id = $1`, [task.id]);
      broadcast("notifications");
      console.log(`⚠ Просрочено задание #${task.id}: «${task.title}»`);
    }
  } catch (e) {
    console.error("Ошибка проверки дедлайнов:", e.message);
  }
}, 60 * 1000);

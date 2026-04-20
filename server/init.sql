-- PostgreSQL schema for Colorado project
-- Run once on a fresh database (Render PostgreSQL)

CREATE TABLE IF NOT EXISTS admin (
  id       SERIAL PRIMARY KEY,
  login    TEXT,
  password TEXT,
  token    TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id            SERIAL PRIMARY KEY,
  name          TEXT,
  password      TEXT,
  avatar        TEXT,
  "activeStart" TEXT,
  "lastEnd"     TEXT,
  salary        NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shifts (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  start_time  TEXT    NOT NULL,
  end_time    TEXT,
  status      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id               SERIAL PRIMARY KEY,
  date             TEXT,
  description      TEXT,
  type             TEXT,
  created_at       TEXT,
  status           TEXT    DEFAULT 'in_progress',
  title            TEXT    DEFAULT '',
  due_time         TEXT,
  overdue_notified INTEGER DEFAULT 0,
  time_from        TEXT,
  main_employee_id INTEGER,
  rating           INTEGER DEFAULT 0,
  completed_at     TEXT,
  completion_day   TEXT
);

CREATE TABLE IF NOT EXISTS task_assigned (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER,
  employee_id INTEGER
);

CREATE TABLE IF NOT EXISTS task_participants (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER,
  employee_id INTEGER
);

CREATE TABLE IF NOT EXISTS task_photos (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL,
  employee_id INTEGER,
  photo_data  TEXT    NOT NULL DEFAULT '',
  photo_path  TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL,
  author     TEXT    NOT NULL,
  comment    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  CONSTRAINT fk_tc_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER,
  date          TEXT,
  time          TEXT,
  message       TEXT,
  status        TEXT,
  task_title    TEXT,
  task_due_time TEXT,
  notif_type    TEXT,
  task_extra    TEXT
);

CREATE TABLE IF NOT EXISTS advances (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  amount      NUMERIC NOT NULL,
  date        TEXT    NOT NULL,
  comment     TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_settings (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL,
  salary      NUMERIC DEFAULT 0,
  norm_hours  NUMERIC DEFAULT 160,
  rate        NUMERIC DEFAULT 0,
  UNIQUE(employee_id, year, month)
);

CREATE TABLE IF NOT EXISTS salary_payments (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  amount      NUMERIC NOT NULL,
  date        TEXT    NOT NULL,
  comment     TEXT    DEFAULT '',
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_logs (
  id         SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  old_amount NUMERIC,
  new_amount NUMERIC,
  changed_at TEXT    NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shifts_emp     ON shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status  ON shifts(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_date     ON tasks(date);
CREATE INDEX IF NOT EXISTS idx_tasks_overdue  ON tasks(status, overdue_notified);
CREATE INDEX IF NOT EXISTS idx_ta_task        ON task_assigned(task_id);
CREATE INDEX IF NOT EXISTS idx_ta_emp         ON task_assigned(employee_id);
CREATE INDEX IF NOT EXISTS idx_tp_task        ON task_participants(task_id);
CREATE INDEX IF NOT EXISTS idx_tph_task       ON task_photos(task_id);
CREATE INDEX IF NOT EXISTS idx_notif_emp      ON notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_notif_date     ON notifications(date);
CREATE INDEX IF NOT EXISTS idx_adv_emp        ON advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_adv_date       ON advances(date);

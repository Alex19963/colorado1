require("dotenv").config();
const sqlite3  = require("sqlite3").verbose();
const { Pool } = require("pg");
const path     = require("path");

const DB_PATH = "c:/Users/user/Desktop/Программы/Colorado finish/server/database.db";

const sqliteDb = new sqlite3.Database(DB_PATH);
const pool     = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

async function resetSeq(client, table) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${table}','id'),
            COALESCE((SELECT MAX(id) FROM ${table}),0)+1, false)`
  );
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("\n🚀 Перенос данных SQLite → PostgreSQL\n");

    // admin
    {
      const rows = await sqliteAll("SELECT * FROM admin");
      for (const r of rows) {
        await client.query(
          `INSERT INTO admin (id,login,password,token) VALUES ($1,$2,$3,$4)
           ON CONFLICT(id) DO UPDATE SET login=$2,password=$3,token=$4`,
          [r.id, r.login, r.password, r.token]
        );
      }
      await resetSeq(client, "admin");
      console.log(`✔ admin — ${rows.length}`);
    }

    // employees
    {
      const rows = await sqliteAll("SELECT * FROM employees");
      for (const r of rows) {
        await client.query(
          `INSERT INTO employees (id,name,password,avatar,"activeStart","lastEnd",salary)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(id) DO UPDATE SET
             name=$2,password=$3,avatar=$4,"activeStart"=$5,"lastEnd"=$6,salary=$7`,
          [r.id, r.name, r.password, r.avatar||null, r.activeStart||null, r.lastEnd||null, r.salary||0]
        );
      }
      await resetSeq(client, "employees");
      console.log(`✔ employees — ${rows.length}`);
    }

    // shifts
    {
      const rows = await sqliteAll("SELECT * FROM shifts");
      for (const r of rows) {
        await client.query(
          `INSERT INTO shifts (id,employee_id,start_time,end_time,status)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT(id) DO UPDATE SET employee_id=$2,start_time=$3,end_time=$4,status=$5`,
          [r.id, r.employee_id, r.start_time, r.end_time||null, r.status]
        );
      }
      await resetSeq(client, "shifts");
      console.log(`✔ shifts — ${rows.length}`);
    }

    // tasks
    {
      const rows = await sqliteAll("SELECT * FROM tasks");
      for (const r of rows) {
        await client.query(
          `INSERT INTO tasks (id,date,description,type,created_at,status,title,due_time,
             overdue_notified,time_from,main_employee_id,rating,completed_at,completion_day)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT(id) DO UPDATE SET
             date=$2,description=$3,type=$4,created_at=$5,status=$6,title=$7,due_time=$8,
             overdue_notified=$9,time_from=$10,main_employee_id=$11,rating=$12,
             completed_at=$13,completion_day=$14`,
          [r.id, r.date||null, r.description||null, r.type||null, r.created_at||null,
           r.status||"in_progress", r.title||"", r.due_time||null,
           r.overdue_notified||0, r.time_from||null, r.main_employee_id||null,
           r.rating||0, r.completed_at||null, r.completion_day||null]
        );
      }
      await resetSeq(client, "tasks");
      console.log(`✔ tasks — ${rows.length}`);
    }

    // task_assigned
    {
      const rows = await sqliteAll("SELECT * FROM task_assigned");
      for (const r of rows) {
        await client.query(
          `INSERT INTO task_assigned (id,task_id,employee_id) VALUES ($1,$2,$3)
           ON CONFLICT(id) DO UPDATE SET task_id=$2,employee_id=$3`,
          [r.id, r.task_id, r.employee_id]
        );
      }
      await resetSeq(client, "task_assigned");
      console.log(`✔ task_assigned — ${rows.length}`);
    }

    // task_participants
    {
      const rows = await sqliteAll("SELECT * FROM task_participants");
      for (const r of rows) {
        await client.query(
          `INSERT INTO task_participants (id,task_id,employee_id) VALUES ($1,$2,$3)
           ON CONFLICT(id) DO UPDATE SET task_id=$2,employee_id=$3`,
          [r.id, r.task_id, r.employee_id]
        );
      }
      await resetSeq(client, "task_participants");
      console.log(`✔ task_participants — ${rows.length}`);
    }

    // task_photos
    {
      const rows = await sqliteAll("SELECT * FROM task_photos");
      for (const r of rows) {
        await client.query(
          `INSERT INTO task_photos (id,task_id,employee_id,photo_data,photo_path,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT(id) DO UPDATE SET
             task_id=$2,employee_id=$3,photo_data=$4,photo_path=$5,created_at=$6`,
          [r.id, r.task_id, r.employee_id||null, r.photo_data||"", r.photo_path||null, r.created_at]
        );
      }
      await resetSeq(client, "task_photos");
      console.log(`✔ task_photos — ${rows.length}`);
    }

    // task_comments
    {
      const rows = await sqliteAll("SELECT * FROM task_comments");
      for (const r of rows) {
        await client.query(
          `INSERT INTO task_comments (id,task_id,author,comment,created_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT(id) DO UPDATE SET task_id=$2,author=$3,comment=$4,created_at=$5`,
          [r.id, r.task_id, r.author, r.comment, r.created_at]
        );
      }
      await resetSeq(client, "task_comments");
      console.log(`✔ task_comments — ${rows.length}`);
    }

    // notifications
    {
      const rows = await sqliteAll("SELECT * FROM notifications");
      for (const r of rows) {
        await client.query(
          `INSERT INTO notifications
             (id,employee_id,date,time,message,status,task_title,task_due_time,notif_type,task_extra)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT(id) DO UPDATE SET
             employee_id=$2,date=$3,time=$4,message=$5,status=$6,
             task_title=$7,task_due_time=$8,notif_type=$9,task_extra=$10`,
          [r.id, r.employee_id||null, r.date||null, r.time||null, r.message||null,
           r.status||null, r.task_title||null, r.task_due_time||null,
           r.notif_type||null, r.task_extra||null]
        );
      }
      await resetSeq(client, "notifications");
      console.log(`✔ notifications — ${rows.length}`);
    }

    // advances
    {
      const rows = await sqliteAll("SELECT * FROM advances");
      for (const r of rows) {
        await client.query(
          `INSERT INTO advances (id,employee_id,amount,date,comment,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT(id) DO UPDATE SET
             employee_id=$2,amount=$3,date=$4,comment=$5,created_at=$6`,
          [r.id, r.employee_id, r.amount, r.date, r.comment||"", r.created_at]
        );
      }
      await resetSeq(client, "advances");
      console.log(`✔ advances — ${rows.length}`);
    }

    // salary_settings
    {
      const rows = await sqliteAll("SELECT * FROM salary_settings");
      for (const r of rows) {
        await client.query(
          `INSERT INTO salary_settings (id,employee_id,year,month,salary,norm_hours,rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(id) DO UPDATE SET
             employee_id=$2,year=$3,month=$4,salary=$5,norm_hours=$6,rate=$7`,
          [r.id, r.employee_id, r.year, r.month, r.salary||0, r.norm_hours||160, r.rate||0]
        );
      }
      await resetSeq(client, "salary_settings");
      console.log(`✔ salary_settings — ${rows.length}`);
    }

    // salary_payments
    {
      const rows = await sqliteAll("SELECT * FROM salary_payments");
      for (const r of rows) {
        await client.query(
          `INSERT INTO salary_payments (id,employee_id,amount,date,comment,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT(id) DO UPDATE SET
             employee_id=$2,amount=$3,date=$4,comment=$5,created_at=$6`,
          [r.id, r.employee_id, r.amount, r.date, r.comment||"", r.created_at]
        );
      }
      await resetSeq(client, "salary_payments");
      console.log(`✔ salary_payments — ${rows.length}`);
    }

    // payment_logs
    {
      const rows = await sqliteAll("SELECT * FROM payment_logs");
      for (const r of rows) {
        await client.query(
          `INSERT INTO payment_logs (id,payment_id,old_amount,new_amount,changed_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT(id) DO UPDATE SET
             payment_id=$2,old_amount=$3,new_amount=$4,changed_at=$5`,
          [r.id, r.payment_id, r.old_amount||null, r.new_amount||null, r.changed_at]
        );
      }
      await resetSeq(client, "payment_logs");
      console.log(`✔ payment_logs — ${rows.length}`);
    }

    console.log("\n✅ Все данные успешно перенесены!\n");

  } catch (err) {
    console.error("\n❌ Ошибка:", err.message);
    process.exit(1);
  } finally {
    client.release();
    sqliteDb.close();
    await pool.end();
  }
}

migrate();

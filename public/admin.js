const API = "";

/* ── Автоматически добавлять x-admin-token к запросам на API ── */
(function patchFetch() {
  const _orig = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    if (typeof url === "string" && url.startsWith(API)) {
      const token = localStorage.getItem("adminToken") || "";
      opts = opts ? { ...opts } : {};
      opts.headers = { "x-admin-token": token, ...(opts.headers || {}) };
    }
    return _orig(url, opts);
  };
})();

/* ── Блокировка автозаполнения в поле поиска сотрудников ──────────── */
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("empSearch");
  if (input) {
    input.setAttribute("readonly", true);
    input.blur();
    setTimeout(() => input.removeAttribute("readonly"), 200);
  }
});

/* ── Утилиты ─────────────────────────────────────────────────────── */
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ── Профиль сотрудника: данные последнего рендера ── */
let _empProfileData = new Map(); // empId → { name, avatarUrl, activeTasks, doneTasks, statusText, startTime, endTime }

/* ── Кэш сотрудников (один источник правды, обновляется при SSE) ── */
let _cachedEmployees = null;
async function fetchEmployees() {
  if (_cachedEmployees) return _cachedEmployees;
  const res = await fetch(API + "/api/employees");
  _cachedEmployees = await res.json();
  return _cachedEmployees;
}
function invalidateEmployeeCache() { _cachedEmployees = null; }

function getLocalISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}




document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll("section").forEach(sec => sec.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.section).classList.add("active");
    document.querySelector(".main").classList.toggle("main--notepad", btn.dataset.section === "notepad");
  };
});

(function () {
  const KEY = "notepad_notes";
  let notes = [];
  let activeId = null;
  let saveTimer = null;

  const $ = id => document.getElementById(id);

  function load() {
    try {
      notes = (JSON.parse(localStorage.getItem(KEY)) || []).map(n => ({
        id: n.id,
        content: n.content ?? n.text ?? "",
        updatedAt: n.updatedAt
      }));
    } catch { notes = []; }
  }

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(notes));
  }

  const pad = n => String(n).padStart(2, "0");

  function fmtCard(ts) {
    const d = new Date(ts);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtFull(ts) {
    const d = new Date(ts);
    const days = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
    return `${days[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function title(content) {
    return (content || "").split(/\r?\n/)[0].trim() || "Без названия";
  }

  function preview(content) {
    const lines = (content || "").split(/\r?\n/).filter(l => l.trim());
    return lines[1] ? lines[1].trim() : "Пустая заметка";
  }

  function render() {
    const q = ($("npSearch").value || "").toLowerCase();
    const list = $("npList");
    const visible = notes
      .filter(n => !q || (n.content || "").toLowerCase().includes(q))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (!visible.length) {
      list.innerHTML = `<div class="np-list-empty">${q ? "Ничего не найдено" : "Нет заметок"}</div>`;
      return;
    }
    list.innerHTML = visible.map(n => `
      <div class="np-card${n.id === activeId ? " np-card--active" : ""}" data-id="${n.id}">
        <div class="np-card-title">${escapeHtml(title(n.content))}</div>
        <div class="np-card-meta">
          <span class="np-card-date">${fmtCard(n.updatedAt)}</span>
          <span class="np-card-sep">·</span>
          <span class="np-card-preview">${escapeHtml(preview(n.content))}</span>
        </div>
      </div>`).join("");

    list.querySelectorAll(".np-card").forEach(c => {
      c.onclick = () => openNote(Number(c.dataset.id));
    });
  }

  function openNote(id) {
    activeId = id;
    const note = notes.find(n => n.id === id);
    if (!note) return;
    $("npEmpty").style.display = "none";
    $("npEditorInner").style.display = "flex";
    $("npTextarea").value = note.content;
    $("npEditorDate").textContent = fmtFull(note.updatedAt);
    render();
    setTimeout(() => $("npTextarea").focus(), 30);
  }

  function closeEditor() {
    activeId = null;
    $("npEmpty").style.display = "";
    $("npEditorInner").style.display = "none";
  }

  function createNote() {
    const note = { id: Date.now(), content: "", updatedAt: Date.now() };
    notes.unshift(note);
    persist();
    render();
    openNote(note.id);
  }

  function deleteNote() {
    if (activeId === null) return;
    const idx = notes.findIndex(n => n.id === activeId);
    notes.splice(idx, 1);
    persist();
    const next = notes[idx] || notes[idx - 1] || null;
    if (next) openNote(next.id);
    else closeEditor();
    render();
  }

  $("npAddBtn").addEventListener("click", createNote);
  $("npDelBtn").addEventListener("click", deleteNote);

  $("npTextarea").addEventListener("input", function () {
    const note = notes.find(n => n.id === activeId);
    if (!note) return;
    note.content = this.value;
    note.updatedAt = Date.now();
    $("npEditorDate").textContent = fmtFull(note.updatedAt);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persist(); render(); }, 500);
  });

  $("npSearch").addEventListener("input", render);

  load();
  render();
})();


function getMonthLimits() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1).toISOString().slice(0, 10);
  const last = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { first, last };
}

function toISODateFromDay(day) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}



async function fetchShifts() {
  const res = await fetch(API + "/api/shifts");
  return await res.json();
}

async function fetchTasks() {
  const res = await fetch(API + "/api/tasks");
  return await res.json();
}



function formatDuration(ms) {
  if (!isFinite(ms) || ms <= 0) return "00:00";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}



async function toggleShift(empId, isActive, shiftStartISO = null) {

  if (window._shiftLock && window._shiftLock[empId]) {
    console.warn("⏸ Повторное нажатие для сотрудника", empId, "игнорируется");
    return;
  }

  // Проверка: завершение смены раньше чем через 6 минут
  if (isActive && shiftStartISO) {
    const elapsedMin = (Date.now() - new Date(shiftStartISO).getTime()) / 60000;
    if (elapsedMin < 6) {
      const confirmed = await showEarlyStopConfirm(Math.floor(elapsedMin));
      if (!confirmed) return;
    }
  }

  window._shiftLock = window._shiftLock || {};
  window._shiftLock[empId] = true;

  try {
    const url = `${API}/api/employees/${empId}/${isActive ? "stop" : "start"}`;
    const res = await fetch(url, { method: "PATCH" });
    const data = await res.json();

    if (!res.ok) {
      console.error("Ошибка ответа сервера:", data);
      alert(data.error || "Ошибка при обновлении смены");
      return;
    }

    console.log(`✅ Смена ${isActive ? "завершена" : "начата"} для #${empId}`);
    invalidateEmployeeCache();
    await refreshEmployees();
  } catch (err) {
    console.error("❌ Ошибка toggleShift:", err);
    alert("Ошибка при обработке смены");
  } finally {

    window._shiftLock[empId] = false;
  }
}






// Модалка подтверждения раннего завершения смены (< 6 мин)
// Возвращает Promise<boolean>
function showEarlyStopConfirm(minutes) {
  return new Promise(resolve => {
    const modal   = document.getElementById("earlyStopModal");
    const msgEl   = document.getElementById("earlyStopMsg");
    const okBtn   = document.getElementById("earlyStopOk");
    const cancelBtn = document.getElementById("earlyStopCancel");
    if (!modal) { resolve(true); return; }

    const mins = minutes < 1 ? "менее минуты" : `${minutes} мин.`;
    if (msgEl) msgEl.textContent = `С момента начала прошло только ${mins}. Вы уверены, что хотите завершить смену?`;

    modal.style.display = "flex";

    function cleanup(result) {
      modal.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk()     { cleanup(true);  }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// avgBase: raw average star rating (number) or null if no rated tasks
function calcCombinedRating(avgBase, doneCount, mainDoneCount) {
  if (avgBase === null) return null;
  const taskBonus = Math.min(doneCount     * 0.04, 0.25);
  const mainBonus = Math.min(mainDoneCount * 0.06, 0.25);
  return Math.min(avgBase + taskBonus + mainBonus, 5.0);
}

function empRatingHtml(tasks, empId, ym) {
  const empDone = tasks.filter(t =>
    t.status === "done" &&
    (t.date || "").startsWith(ym) &&
    (
      (Array.isArray(t.assignedEmployees) && t.assignedEmployees.includes(empId)) ||
      (Array.isArray(t.participants)      && t.participants.includes(empId))
    )
  );
  const rated         = empDone.filter(t => t.rating > 0);
  const mainDoneCount = empDone.filter(t => Array.isArray(t.assignedEmployees) && t.assignedEmployees.includes(empId)).length;
  const avgBase       = rated.length ? rated.reduce((s, t) => s + Number(t.rating), 0) / rated.length : null;
  const combined      = calcCombinedRating(avgBase, empDone.length, mainDoneCount);
  const display       = combined !== null ? combined.toFixed(1) : "—";
  const filled        = combined !== null ? Math.round(combined) : 0;
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    stars += `<span class="ec-star ${i <= filled ? "ec-star--on" : "ec-star--off"}">★</span>`;
  }
  return `<div class="ec-rating">${stars}<span class="ec-rating-val">${display}</span></div>`;
}

async function loadEmployees() {
  invalidateEmployeeCache();
  let employees = await fetchEmployees();
  const shifts = await fetchShifts();
  const allTasks = await fetchTasks();
  const today = getLocalISODate();

  const filter = document.getElementById("empFilter")?.value || "all";
  const search = document.getElementById("empSearch")?.value.toLowerCase() || "";
  const cards = document.getElementById("employeeCards");
  if (!cards) return;
  cards.innerHTML = "";

  employees.forEach(emp => {
    const empShifts = shifts.filter(s => s.employee_id === emp.id);

    let isActive = false;
    let startTime = "—";
    let endTime = "—";

    if (empShifts.length > 0) {
      const lastShift = empShifts.slice().sort((a, b) => b.id - a.id)[0];
      if (lastShift.status === "open") {
        isActive = true;
        startTime = lastShift.start_time ? lastShift.start_time.slice(11, 16) : "—";
      } else if (lastShift.status === "closed") {
        startTime = lastShift.start_time ? lastShift.start_time.slice(11, 16) : "—";
        endTime = lastShift.end_time ? lastShift.end_time.slice(11, 16) : "—";
      }
    }

    if (filter === "on" && !isActive) return;
    if (filter === "off" && isActive) return;

    if (
      search &&
      !emp.name.toLowerCase().includes(search) &&
      !emp.password.toLowerCase().includes(search)
    ) {
      return;
    }

    const todaysTasksAll = allTasks.filter(t =>
      t.date === today &&
      (
        (Array.isArray(t.assignedEmployees) && t.assignedEmployees.includes(emp.id)) ||
        (Array.isArray(t.participants) && t.participants.includes(emp.id))
      )
    );

    const activeTasks = todaysTasksAll.filter(t => t.status !== "done").length;
    const doneTasks = todaysTasksAll.filter(t => t.status === "done").length;

    const avatarUrl = emp.avatar
      ? (emp.avatar.startsWith("/uploads/") ? (API + emp.avatar) : emp.avatar)
      : defaultAvatarSvg;

    const card = document.createElement("article");
    card.className = "employee-card";
    card.innerHTML = `
      <div class="employee-card-head">
        <div class="employee-card-person">
          <img class="employee-card-avatar" src="${avatarUrl}" alt="${escapeHtml(emp.name)}">
          <h4 class="employee-card-name">${escapeHtml(emp.name)}</h4>
        </div>
        <span class="employee-card-status ${isActive ? "on" : "off"}">
          ${isActive ? "На смене" : "Вне смены"}
        </span>
      </div>

      <div class="employee-card-secondary">
        <span>\u0412 \u0440\u0430\u0431\u043e\u0442\u0435: <strong>${activeTasks}</strong></span>
        <span>\u0412\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e: <strong>${doneTasks}</strong></span>
      </div>

      <div class="employee-card-primary">
        <span>\u041d\u0430\u0447\u0430\u043b\u043e: <strong>${startTime}</strong></span>
        <span>\u041a\u043e\u043d\u0435\u0446: <strong>${endTime}</strong></span>
      </div>

      ${empRatingHtml(allTasks, emp.id, today.slice(0, 7))}

      <div class="employee-card-actions">
        <button class="btn startStopBtn" data-id="${emp.id}" data-active="${isActive}">
          ${isActive ? "Завершить" : "Начать"}
        </button>
        <button class="btn showTasksBtn" data-id="${emp.id}">Задания</button>
      </div>
    `;

    cards.appendChild(card);
  });

  if (!cards.children.length) {
    cards.innerHTML = `<div class="employee-cards-empty">Сотрудники не найдены</div>`;
  }

  document.querySelectorAll(".startStopBtn").forEach(b => {
    const newBtn = b.cloneNode(true);
    b.parentNode.replaceChild(newBtn, b);

    newBtn.onclick = async () => {
      newBtn.disabled = true;
      newBtn.style.opacity = "0.6";

      const id = Number(newBtn.dataset.id);
      const active = newBtn.dataset.active === "true";

      try {
        await toggleShift(id, active);
        await updateLiveWorkTime();
      } catch (err) {
        console.error("Ошибка при смене:", err);
      } finally {
        newBtn.disabled = false;
        newBtn.style.opacity = "1";
      }
    };
  });

  document.querySelectorAll(".showTasksBtn").forEach(b => {
    b.onclick = () => openTasksModalForEmployee(Number(b.dataset.id));
  });

  await populateEmployeeCheckboxes();
}

async function populateEmployeeCheckboxes() {
  const list = document.getElementById("employeeCheckboxes");
  if (!list) return;

  list.innerHTML = "";
  const employees = await fetchEmployees();

  employees.forEach(emp => {
    const wrap = document.createElement("label");
    wrap.className = "checkbox-item";

    wrap.innerHTML = `
      <input type="checkbox" class="emp-check" data-id="${emp.id}">
      <span>${escapeHtml(emp.name)}</span>
    `;

    list.appendChild(wrap);
  });
}




const defaultAvatarSvg = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#3a404d"/><circle cx="40" cy="30" r="14" fill="#222831"/><path d="M14 70c5-13 17-20 26-20s21 7 26 20" fill="none" stroke="#222831" stroke-width="6" stroke-linecap="round"/></svg>');
let addEmployeePhotoData = "";
let addEmployeePhotoFile = null;

function setAddEmployeeAvatar(src) {
  const preview = document.getElementById("empPhotoPreview");
  if (!preview) return;
  preview.src = src || defaultAvatarSvg;
}

function resetAddEmployeeModal() {
  const nameEl = document.getElementById("empName");
  const pwdEl = document.getElementById("empPwd");
  const photoInput = document.getElementById("empPhotoInput");

  if (nameEl) nameEl.value = "";
  if (pwdEl) pwdEl.value = "";
  if (photoInput) photoInput.value = "";

  addEmployeePhotoData = "";
  addEmployeePhotoFile = null;
  setAddEmployeeAvatar(defaultAvatarSvg);

  // Сбрасываем ошибки (функция может быть ещё не объявлена при первом вызове)
  if (typeof _addEmpClearAllErrors === "function") _addEmpClearAllErrors();
}

document.getElementById("addEmployeeBtn").onclick = () => {
  resetAddEmployeeModal();
  document.getElementById("addModal").style.display = "flex";
};

const _closeAddEmpModal = () => {
  document.getElementById("addModal").style.display = "none";
};
document.getElementById("cancelAdd").onclick  = _closeAddEmpModal;
const _addEmpCloseBtn = document.getElementById("addEmpCloseBtn");
if (_addEmpCloseBtn) _addEmpCloseBtn.onclick  = _closeAddEmpModal;

const empPhotoInput = document.getElementById("empPhotoInput");
if (empPhotoInput) {
  empPhotoInput.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Выберите изображение");
      e.target.value = "";
      return;
    }

    addEmployeePhotoFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      addEmployeePhotoData = result;
      setAddEmployeeAvatar(result);
    };
    reader.readAsDataURL(file);
  };
}

setAddEmployeeAvatar(defaultAvatarSvg);

function _addEmpShowFieldError(fieldId, errorId, msg) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(errorId);
  if (input) input.classList.add("field-error");
  if (err)   { err.textContent = msg; err.classList.add("visible"); }
}
function _addEmpClearFieldError(fieldId, errorId) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(errorId);
  if (input) input.classList.remove("field-error");
  if (err)   { err.textContent = ""; err.classList.remove("visible"); }
}
function _addEmpClearAllErrors() {
  _addEmpClearFieldError("empName", "addEmpNameError");
  _addEmpClearFieldError("empPwd",  "addEmpPwdError");
}

// Очищаем ошибку поля при вводе + фильтруем нецифровые символы в пароле
document.getElementById("empName").addEventListener("input", () => _addEmpClearFieldError("empName", "addEmpNameError"));
document.getElementById("empPwd").addEventListener("input", function() {
  const pos = this.selectionStart;
  const filtered = this.value.replace(/\D/g, "");
  if (this.value !== filtered) {
    this.value = filtered;
    this.setSelectionRange(pos - 1, pos - 1);
  }
  _addEmpClearFieldError("empPwd", "addEmpPwdError");
});

document.getElementById("saveAdd").onclick = async () => {
  _addEmpClearAllErrors();

  const name = document.getElementById("empName").value.trim();
  const pwd  = document.getElementById("empPwd").value.trim();

  let hasError = false;
  if (!name) { _addEmpShowFieldError("empName", "addEmpNameError", "Введите ФИО сотрудника"); hasError = true; }
  if (!pwd) {
    _addEmpShowFieldError("empPwd", "addEmpPwdError", "Введите пароль"); hasError = true;
  } else if (!/^\d{4,}$/.test(pwd)) {
    _addEmpShowFieldError("empPwd", "addEmpPwdError", pwd.length < 4 ? "Пароль должен содержать минимум 4 цифры" : "Пароль может состоять только из цифр (0–9)"); hasError = true;
  }
  if (hasError) return;

  let avatarToSend = addEmployeePhotoData;
  if (addEmployeePhotoFile) {
    try {
      const fd = new FormData();
      fd.append("avatar", addEmployeePhotoFile);
      const upR = await fetch(API + "/api/upload/avatar", { method: "POST", body: fd });
      if (upR.ok) { const upJ = await upR.json(); avatarToSend = upJ.url; }
    } catch { /* оставляем base64 */ }
  }

  const res = await fetch(API + "/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password: pwd, avatar: avatarToSend })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg  = data.error || "";
    if (msg.toLowerCase().includes("имен") || msg.toLowerCase().includes("name")) {
      _addEmpShowFieldError("empName", "addEmpNameError", msg);
    } else if (msg.toLowerCase().includes("пароль") || msg.toLowerCase().includes("password")) {
      _addEmpShowFieldError("empPwd", "addEmpPwdError", msg);
    } else {
      _addEmpShowFieldError("empName", "addEmpNameError", msg || "Ошибка при добавлении сотрудника");
    }
    return;
  }

  document.getElementById("addModal").style.display = "none";
  invalidateEmployeeCache();
  await refreshEmployees();
};
let availableDates = [];
let selectedDate = null;

function updateTaskCalendarUI(date) {
  const btn = document.getElementById("taskCalendarToggle");
  if (!btn || !date) return;
  const [y, m, dNum] = date.split("-");
  const d = new Date(Number(y), Number(m) - 1, Number(dNum));
  const weekday = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()];
  const day = d.getDate().toString().padStart(2, "0");
  const isToday = date === getLocalISODate();
  btn.textContent = isToday ? `${weekday} ${day} ▼ (сегодня)` : `${weekday} ${day} ▼`;
}

async function refreshTaskDateSelector(forceToday = false) {
  const tasks = await fetchTasks();
  const select = document.getElementById("taskDateSelect");
  const { first, last } = getMonthLimits();

  availableDates = [...new Set(
    tasks.map(t => t.date).filter(d => d >= first && d <= last)
  )].sort();

  if (select) {
    select.innerHTML = "";
  }

  const today = getLocalISODate();

  // Всегда переключаться на сегодня при первом открытии или смене дня
  if (forceToday || !selectedDate) {
    selectedDate = today;
  } else if (!availableDates.includes(selectedDate) && selectedDate !== today) {
    // Выбранная дата исчезла (удалены все задания) — вернуться к последней доступной или сегодня
    selectedDate = availableDates[availableDates.length - 1] || today;
  }

  if (select) {
    // Всегда включать сегодня в список, даже если заданий нет
    const optionDates = [...new Set([...availableDates, today])].sort();
    optionDates.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === selectedDate) opt.selected = true;
      select.appendChild(opt);
    });

    select.onchange = () => {
      selectedDate = select.value;
      updateTaskCalendarUI(selectedDate);
      loadTasksTable();
    };
  }

  updateTaskCalendarUI(selectedDate);
  await loadTasksTable();
}



/* ─── Кастомный confirm удаления ────────────────────────────────── */
function confirmDelete(onConfirm, { title, text, okLabel } = {}) {
  const overlay    = document.getElementById("confirmDeleteModal");
  const okBtn      = document.getElementById("confirmDelOk");
  const cancelBtn  = document.getElementById("confirmDelCancel");
  const titleEl    = overlay.querySelector(".confirm-del-title");
  const textEl     = overlay.querySelector(".confirm-del-text");
  const labelEl    = document.getElementById("confirmDelOkLabel");

  const prevTitle   = titleEl.textContent;
  const prevText    = textEl.textContent;
  const prevLabel   = labelEl ? labelEl.textContent : null;

  if (title)   titleEl.textContent = title;
  if (text)    textEl.textContent  = text;
  if (okLabel && labelEl) labelEl.textContent = okLabel;

  overlay.style.display = "flex";

  function close() {
    overlay.style.display = "none";
    okBtn.onclick     = null;
    cancelBtn.onclick = null;
    titleEl.textContent = prevTitle;
    textEl.textContent  = prevText;
    if (labelEl && prevLabel !== null) labelEl.textContent = prevLabel;
  }
  okBtn.onclick     = () => { close(); onConfirm(); };
  cancelBtn.onclick = close;
  overlay.onclick   = (e) => { if (e.target === overlay) close(); };
}

/* ─── Вспомогательные функции ───────────────────────────────────── */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTaskTime(timeFrom, timeTo) {
  if (timeFrom && timeTo) return `${timeFrom} — ${timeTo}`;
  if (timeTo)             return `до ${timeTo}`;
  if (timeFrom)           return `с ${timeFrom}`;
  return "";
}

function computeTaskStatus(task) {
  if (task.status === "done") return "done";
  if (task.due_time && task.date) {
    const due = new Date(task.date + "T" + task.due_time);
    if (new Date() > due) return "overdue";
  }
  const hasAssigned = (task.assignedEmployees && task.assignedEmployees.length > 0) ||
                      (task.participants && task.participants.length > 0);
  return hasAssigned ? "in_progress" : "new";
}

const STATUS_LABEL = {
  new:         "Новое",
  in_progress: "В работе",
  done:        "Выполнено",
  overdue:     "Просрочено",
};

/* ─── Главная функция рендера карточек ──────────────────────────── */
async function loadTasksTable() {
  const [tasks, employees] = await Promise.all([fetchTasks(), fetchEmployees()]);
  const empMap = {};
  employees.forEach(e => { empMap[e.id] = e.name; });

  const cards = document.getElementById("taskCards");
  if (!cards) return;
  cards.innerHTML = "";

  if (!selectedDate) return;

  const searchValue = document.getElementById("taskSearch")?.value?.trim().toLowerCase() || "";
  const todaysTasks = tasks.filter(t =>
    (t.status !== "done"
      ? t.date <= selectedDate
      : (t.completed_at || "").slice(0, 10) === selectedDate) &&
    (!searchValue || (t.title && t.title.toLowerCase().includes(searchValue)))
  ).sort((a, b) => (a.status === "done") - (b.status === "done"));

  if (todaysTasks.length === 0) {
    cards.innerHTML = `<div class="task-cards-empty">Нет заданий на выбранную дату</div>`;
    return;
  }

  todaysTasks.forEach(t => {
    const status   = computeTaskStatus(t);
    const allIds   = [...new Set([...(t.assignedEmployees || []), ...(t.participants || [])])];
    const mainId   = t.main_employee_id || null;
    const mainName = mainId ? (empMap[mainId] || null) : null;
    const otherIds = allIds.filter(id => id !== mainId);
    const otherNames = otherIds.map(id => empMap[id]).filter(Boolean);
    const isDone   = status === "done";

    // Блок времени
    const timeStr = formatTaskTime(t.time_from, t.due_time);

    // Блок сотрудников
    const empHtml = (() => {
      const parts = [];
      if (mainName) parts.push(`
        <div class="tc-emp-main">
          <span class="tc-emp-main-name">${escapeHtml(mainName)}</span>
          <span class="tc-emp-main-badge">Главный</span>
        </div>`);
      otherNames.forEach(name => {
        parts.push(`<div class="tc-emp-other">${escapeHtml(name)}</div>`);
      });
      if (!mainName && !otherNames.length) parts.push(`<div class="tc-emp-none">Не назначен</div>`);
      return parts.join("");
    })();

    const card = document.createElement("article");
    card.className = `task-card tc--${status}`;
    card.dataset.id = t.id;

    card.innerHTML = `
      <div class="tc-header">
        <span class="tc-badge tc-badge--${status}">${STATUS_LABEL[status]}</span>
        ${timeStr ? `<span class="tc-time">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${timeStr}
        </span>` : ""}
      </div>
      <div class="tc-body">
        <h4 class="tc-title">${escapeHtml(t.title || "(без заголовка)")}</h4>
        ${t.description ? `<p class="tc-desc">${escapeHtml(t.description)}</p>` : ""}
      </div>
      <div class="tc-employees">${empHtml}</div>
      <div class="tc-footer">
        <button class="tc-btn ${isDone ? "tc-btn--undo" : "tc-btn--done"} tcToggleBtn" data-id="${t.id}">
          ${isDone
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 14 4 9 9 4"/><line x1="20" y1="20" x2="4" y2="9"/></svg> Отменить`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Выполнено`}
        </button>
        <button class="tc-btn tc-btn--edit tcEditBtn" data-id="${t.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Изменить
        </button>
        <button class="tc-btn tc-btn--del tcDeleteBtn" data-id="${t.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Удалить
        </button>
        <button class="tc-btn tc-btn--comments tcCommentsBtn" data-id="${t.id}" data-done="${isDone ? '1' : '0'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Комментарии
        </button>
      </div>
      ${isDone ? `
      <div class="tc-rating" data-id="${t.id}">
        <span class="tc-rating-lbl">Оценка</span>
        <div class="tc-stars">
          ${[1,2,3,4,5].map(i => `<button class="tc-star${(t.rating||0) >= i ? " tc-star--on" : ""}" data-val="${i}" aria-label="${i} из 5">★</button>`).join("")}
        </div>
        ${t.rating ? `<span class="tc-rating-val">${t.rating}/5</span>` : `<span class="tc-rating-hint">не оценено</span>`}
      </div>` : ""}
      <div class="tc-dates">
        <div class="tc-dates-row"><span class="tc-dates-lbl">Создано</span><span class="tc-dates-val">${fmtTaskDate(t.created_at || t.date)}</span></div>
        ${isDone && t.completed_at ? `<div class="tc-dates-row"><span class="tc-dates-lbl">Выполнено</span><span class="tc-dates-val">${fmtTaskDate(t.completed_at)}</span></div>` : ""}
      </div>
    `;

    cards.appendChild(card);
  });

  /* Кнопка «Выполнено / Отменить» */
  cards.querySelectorAll(".tcToggleBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const res = await fetch(API + "/api/tasks/" + id + "/toggle", { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { console.error(data.error); return; }
      await loadTasksTable();
      await loadEmployees();
    };
  });

  /* Рейтинг звёздами */
  cards.querySelectorAll(".tc-rating").forEach(block => {
    const taskId = Number(block.dataset.id);
    const stars  = block.querySelectorAll(".tc-star");

    // Hover: подсветить 1..hovered
    stars.forEach((star, idx) => {
      star.addEventListener("mouseenter", () => {
        stars.forEach((s, i) => s.classList.toggle("tc-star--hover", i <= idx));
      });
      star.addEventListener("mouseleave", () => {
        stars.forEach(s => s.classList.remove("tc-star--hover"));
      });
      star.addEventListener("click", async () => {
        const rating = Number(star.dataset.val);
        await fetch(`${API}/api/tasks/${taskId}/rating`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating })
        });
        await loadTasksTable();
        invalidateEmployeeCache();
        refreshEmployees();
      });
    });
  });

  /* Кнопка «Изменить» */
  cards.querySelectorAll(".tcEditBtn").forEach(btn => {
    btn.onclick = () => openEditModal(Number(btn.dataset.id));
  });

  /* Кнопка «Удалить» */
  cards.querySelectorAll(".tcDeleteBtn").forEach(btn => {
    btn.onclick = () => {
      confirmDelete(async () => {
        const id = Number(btn.dataset.id);
        const res = await fetch(API + "/api/tasks/" + id, { method: "DELETE" });
        if (!res.ok) { console.error("Ошибка удаления"); return; }
        await refreshTaskDateSelector();
        await loadTasksTable();
        await loadEmployees();
      });
    };
  });

  /* Кнопка «Комментарии» */
  cards.querySelectorAll(".tcCommentsBtn").forEach(btn => {
    btn.onclick = () => openTaskCommentsModal(Number(btn.dataset.id), btn.dataset.done === "1");
  });
}



const taskSearch = document.getElementById("taskSearch");
if (taskSearch) {
  taskSearch.oninput = debounce(async () => { await loadTasksTable(); }, 220);
}




function openTaskDetailModal(t, empMap) {
  const isDone   = t.status === "done";
  const mainId   = t.main_employee_id || null;
  const mainName = mainId ? (empMap[mainId] || "—") : null;
  const allIds   = [...new Set([...(t.assignedEmployees || []), ...(t.participants || [])])];
  const otherIds = allIds.filter(id => id !== mainId);
  const otherNames = otherIds.map(id => empMap[id]).filter(Boolean);

  const empHtml = (() => {
    const parts = [];
    if (mainName) parts.push(
      '<div class="tdm-emp-main">' +
      '<span class="tdm-emp-main-name">' + escapeHtml(mainName) + '</span>' +
      '<span class="tdm-emp-main-badge">Главный</span>' +
      '</div>'
    );
    otherNames.forEach(n => parts.push('<div class="tdm-emp-other">' + escapeHtml(n) + '</div>'));
    if (!mainName && !otherNames.length) parts.push('<div class="tdm-emp-none">Не назначен</div>');
    return parts.join("");
  })();

  document.getElementById("tdmTitle").textContent = t.title || "(без заголовка)";
  document.getElementById("tdmBody").innerHTML =
    '<div class="tdm-section">' +
      '<div class="tdm-label">Статус</div>' +
      '<div class="tdm-status tdm-status--' + (isDone ? "done" : "in_progress") + '">' +
        (isDone ? "Выполнено" : "В работе") +
      '</div>' +
    '</div>' +
    (t.description
      ? '<div class="tdm-section"><div class="tdm-label">Описание</div><div class="tdm-desc">' + escapeHtml(t.description) + '</div></div>'
      : "") +
    '<div class="tdm-section">' +
      '<div class="tdm-label">Сотрудники</div>' +
      empHtml +
    '</div>' +
    '<div class="tdm-section">' +
      '<div class="tdm-label">Даты</div>' +
      '<div class="tdm-dates">' +
        '<div class="tdm-date-row"><span class="tdm-date-lbl">Создано</span><span class="tdm-date-val">' + fmtTaskDate(t.created_at || t.date) + '</span></div>' +
        (isDone && t.completed_at
          ? '<div class="tdm-date-row"><span class="tdm-date-lbl">Выполнено</span><span class="tdm-date-val">' + fmtTaskDate(t.completed_at) + '</span></div>'
          : "") +
      '</div>' +
    '</div>';

  document.getElementById("taskDetailModal").style.display = "flex";
}

(function initTaskDetailModal() {
  const overlay = document.getElementById("taskDetailModal");
  if (!overlay) return;
  const close = () => { overlay.style.display = "none"; };
  document.getElementById("tdmClose").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
})();











const prevDayBtn = document.getElementById("prevDay");
if (prevDayBtn) {
  prevDayBtn.onclick = () => {
    if (!selectedDate) return;
    const i = availableDates.indexOf(selectedDate);
    if (i > 0) {
      selectedDate = availableDates[i - 1];
      const select = document.getElementById("taskDateSelect");
      if (select) select.value = selectedDate;
      updateTaskCalendarUI(selectedDate);
      loadTasksTable();
    }
  };
}

const nextDayBtn = document.getElementById("nextDay");
if (nextDayBtn) {
  nextDayBtn.onclick = () => {
    if (!selectedDate) return;
    const i = availableDates.indexOf(selectedDate);
    if (i < availableDates.length - 1) {
      selectedDate = availableDates[i + 1];
      const select = document.getElementById("taskDateSelect");
      if (select) select.value = selectedDate;
      updateTaskCalendarUI(selectedDate);
      loadTasksTable();
    }
  };
}



const _closeTasksModal = () => {
  document.getElementById("tasksModal").style.display = "none";
  const daysSel = document.getElementById("tiDaySelect");
  if (daysSel) { daysSel.style.display = "none"; daysSel.onchange = null; }
};
document.getElementById("closeTasksModal").onclick     = _closeTasksModal;
document.getElementById("closeTasksModalFoot").onclick = _closeTasksModal;
// Закрытие по клику на overlay
document.getElementById("tasksModal").addEventListener("click", e => {
  if (e.target === document.getElementById("tasksModal")) _closeTasksModal();
});



async function openTaskViewModal(taskId) {
  const tasks = await fetchTasks();

  const task = tasks.find(t => t.id === taskId);
  if (!task) return alert("Задание не найдено");

  const list = document.getElementById("tasksList");
  const title = document.getElementById("tasksModalTitle");


  title.textContent = "Просмотр задания";


const allParticipantIds = [
  ...(Array.isArray(task.participants) ? task.participants : []),
  ...(Array.isArray(task.assignedEmployees) ? task.assignedEmployees : [])
];


const participantNames = [...new Set(allParticipantIds)]
  .filter(Boolean);




  list.innerHTML = `
      <div class="task-title">${task.title || "(Р±РµР· заголовка)"}</div>
      <div class="task-body">${task.description || "(Р±РµР· описания)"}</div>
      <div class="task-status">
      </div>
      <div style="margin-top:10px;">
        <strong>Сотрудники:</strong> ${participantNames.length ? participantNames.join(", ") : "—"}
      </div>

      <div class="task-actions">
        <button class="btn editTaskBtn" data-id="${task.id}">Редактировать</button>
        <button class="btn deleteTaskBtn" data-id="${task.id}">Удалить</button>
        <button class="btn toggleTaskBtn" data-id="${task.id}">
        </button>
      </div>
    </div>
  `;

  document.getElementById("tasksModal").style.display = "flex";


  document.querySelector(".editTaskBtn").onclick = () => {
    document.getElementById("tasksModal").style.display = "none";
    openEditModal(task.id);
  };


  document.querySelector(".deleteTaskBtn").onclick = () => {
    confirmDelete(async () => {
      await fetch(API + "/api/tasks/" + task.id, { method: "DELETE" });
      document.getElementById("tasksModal").style.display = "none";
      await refreshTaskDateSelector();
      await loadEmployees();
    });
  };


  document.querySelector(".toggleTaskBtn").onclick = async () => {
    await fetch(API + "/api/tasks/" + task.id + "/toggle", { method: "PATCH" });
    await openTaskViewModal(task.id);
    await loadTasksTable();
    await loadEmployees();
  };
}



/* ── Общий рендер карточек задач в модалке ──────────────────────── */
// Рисует task-item карточки в контейнер list.
// onToggle(id) / onEdit(id) / onDelete(id) — колбэки действий.
function renderTaskItems(list, tasks, empMap, { onToggle, onEdit, onDelete, onComments, readOnly = false } = {}) {
  list.innerHTML = "";
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "ti-empty";
    empty.textContent = "Заданий на выбранную дату нет";
    list.appendChild(empty);
    return;
  }

  tasks.forEach(t => {
    const status     = computeTaskStatus(t);
    const allIds     = [...new Set([...(t.assignedEmployees || []), ...(t.participants || [])])];
    const mainId     = t.main_employee_id || null;
    const mainName   = mainId ? (empMap[mainId] || null) : null;
    const otherIds   = allIds.filter(id => id !== mainId);
    const otherNames = otherIds.map(id => empMap[id]).filter(Boolean);
    const isDone     = status === "done";
    const timeStr    = formatTaskTime(t.time_from, t.due_time);

    const empHtml = (() => {
      const parts = [];
      if (mainName) parts.push(
        '<div class="tc-emp-main">' +
          '<span class="tc-emp-main-name">' + escapeHtml(mainName) + '</span>' +
          '<span class="tc-emp-main-badge">Главный</span>' +
        '</div>'
      );
      otherNames.forEach(name => parts.push('<div class="tc-emp-other">' + escapeHtml(name) + '</div>'));
      if (!mainName && !otherNames.length) parts.push('<div class="tc-emp-none">Не назначен</div>');
      return parts.join("");
    })();

    const timeHtml = timeStr
      ? '<span class="tc-time"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + timeStr + '</span>'
      : "";

    const toggleSvg = isDone
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 14 4 9 9 4"/><line x1="20" y1="20" x2="4" y2="9"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';

    const item = document.createElement("article");
    item.className  = "task-item tc--" + status;
    item.dataset.id = t.id;
    item.innerHTML  =
      '<div class="tc-header">' +
        '<span class="tc-badge tc-badge--' + status + '">' + STATUS_LABEL[status] + '</span>' +
        timeHtml +
      '</div>' +
      '<div class="tc-body">' +
        '<h4 class="tc-title">' + escapeHtml(t.title || "(без заголовка)") + '</h4>' +
        (t.description ? '<p class="tc-desc">' + escapeHtml(t.description) + '</p>' : "") +
        '<div class="tc-dates">' +
          '<span class="tc-dates-item">Создано: ' + fmtReportDate(t.created_at) + '</span>' +
          '<span class="tc-dates-item tc-dates-completed">' +
            'Завершено: ' + (t.completion_day
              ? t.completion_day.slice(8, 10) + '.' + t.completion_day.slice(5, 7) + '.' + t.completion_day.slice(0, 4)
              : fmtReportDate(t.status === "done" ? t.completed_at : null)) +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div class="tc-employees">' + empHtml + '</div>' +
      (readOnly ? "" :
        '<div class="tc-footer ti-footer">' +
          '<div class="ti-footer-left">' +
            '<button class="tc-btn ' + (isDone ? "tc-btn--undo" : "tc-btn--done") + ' tiToggleBtn" data-id="' + t.id + '">' +
              toggleSvg + " " + (isDone ? "Отменить" : "Выполнено") +
            '</button>' +
            '<button class="tc-btn tc-btn--icon tc-btn--muted tiEditBtn" data-id="' + t.id + '" title="Изменить" aria-label="Изменить">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
            '</button>' +
            '<button class="tc-btn tc-btn--icon tc-btn--muted-del tiDeleteBtn" data-id="' + t.id + '" title="Удалить" aria-label="Удалить">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="ti-footer-right">' +
            '<button class="tc-btn tc-btn--comments tiCommentsBtn" data-id="' + t.id + '" data-done="' + (isDone ? "1" : "0") + '">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
              " Комментарии" +
            '</button>' +
          '</div>' +
        '</div>'
      );

    list.appendChild(item);
  });

  if (onToggle) list.querySelectorAll(".tiToggleBtn").forEach(btn => {
    btn.onclick = () => onToggle(Number(btn.dataset.id));
  });
  if (onEdit) list.querySelectorAll(".tiEditBtn").forEach(btn => {
    btn.onclick = () => onEdit(Number(btn.dataset.id));
  });
  if (onDelete) list.querySelectorAll(".tiDeleteBtn").forEach(btn => {
    btn.onclick = () => onDelete(Number(btn.dataset.id));
  });
  if (onComments) list.querySelectorAll(".tiCommentsBtn").forEach(btn => {
    btn.onclick = () => onComments(Number(btn.dataset.id), btn.dataset.done === "1");
  });
}

async function openTasksModalForEmployee(empId, specificDate = null) {
  const [tasks, employees] = await Promise.all([fetchTasks(), fetchEmployees()]);
  const empMap = {};
  employees.forEach(e => { empMap[e.id] = e.name; });

  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const list  = document.getElementById("tasksList");
  const title = document.getElementById("tasksModalTitle");
  const targetDate = specificDate || new Date().toISOString().slice(0, 10);

  title.textContent = emp.name;
  title.style.display = "";

  const assigned = tasks.filter(t =>
    (t.status !== "done"
      ? t.date <= targetDate
      : (t.completed_at || "").slice(0, 10) === targetDate) &&
    (
      (Array.isArray(t.assignedEmployees) && t.assignedEmployees.includes(empId)) ||
      (Array.isArray(t.participants)      && t.participants.includes(empId))
    )
  );

  renderTaskItems(list, assigned, empMap, {
    onToggle: async (id) => {
      await fetch(API + "/api/tasks/" + id + "/toggle", { method: "PATCH" });
      await openTasksModalForEmployee(empId, specificDate);
      await loadTasksTable();
      await loadEmployees();
    },
    onEdit: (id) => {
      document.getElementById("tasksModal").style.display = "none";
      openEditModal(id);
    },
    onDelete: (id) => {
      confirmDelete(async () => {
        await fetch(API + "/api/tasks/" + id, { method: "DELETE" });
        await openTasksModalForEmployee(empId, specificDate);
        await refreshTaskDateSelector();
        await loadEmployees();
      });
    },
    onComments: (id, done) => openTaskCommentsModal(id, done)
  });

  document.getElementById("tasksModal").style.display = "flex";
}










const reportState = {
  rows: [],
  employeeId: null,
  employeeName: "",
  from: "",
  to: ""
};

function fmtReportDate(str) {
  if (!str) return "—";
  const s = String(str).replace(" ", "T");
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTaskDate(iso) {
  if (!iso) return "";
  const str = String(iso).replace(" ", "T");
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    const s = str.slice(0, 10).split("-");
    return `${s[2]}.${s[1]}.${s[0]}`;
  }
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Состояние месячного фильтра отчёта ───────────────────────────────
const _repNow = new Date();
let _repYear  = _repNow.getFullYear();
let _repMonth = _repNow.getMonth() + 1;
const REP_MONTHS = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

function getMonthRange(year, month) {
  const y    = year;
  const m    = String(month).padStart(2, "0");
  const last = new Date(year, month, 0).getDate();
  const now  = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const toDay = isCurrentMonth
    ? String(now.getDate()).padStart(2, "0")
    : String(last).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${toDay}` };
}

function isRepFuturePeriod() {
  const now = new Date();
  return _repYear > now.getFullYear() ||
    (_repYear === now.getFullYear() && _repMonth > now.getMonth() + 1);
}

function updateReportMonthLabel() {
  const toggle = document.getElementById("reportMonthToggle");
  if (toggle) toggle.textContent = `${REP_MONTHS[_repMonth - 1]} ${_repYear} ▼`;
}

function renderReportMonthMenu() {
  const menu = document.getElementById("reportMonthMenu");
  const drop = document.getElementById("reportMonthDropdown");
  if (!menu) return;
  menu.innerHTML = "";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);";
  header.innerHTML = `
    <span data-dir="-1" style="cursor:pointer;padding:2px 8px;font-size:13px;color:var(--muted);">◀</span>
    <span style="font-weight:600;font-size:13px;">${_repYear}</span>
    <span data-dir="1"  style="cursor:pointer;padding:2px 8px;font-size:13px;color:var(--muted);">▶</span>
  `;
  menu.appendChild(header);

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:6px;";
  REP_MONTHS.forEach((name, i) => {
    const m    = i + 1;
    const cell = document.createElement("div");
    cell.textContent = name;
    cell.className   = "day";
    cell.style.cssText = "text-align:center;border-radius:5px;";
    if (m === _repMonth) {
      cell.style.background = "var(--accent)";
      cell.style.color = "#fff";
    }
    cell.addEventListener("click", async () => {
      _repMonth = m;
      updateReportMonthLabel();
      drop?.classList.remove("open");
      await generateReport();
    });
    grid.appendChild(cell);
  });
  menu.appendChild(grid);

  header.querySelectorAll("[data-dir]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _repYear += Number(btn.dataset.dir);
      renderReportMonthMenu();
    });
  });
}

function parseISODateLocal(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateRu(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
}

function getDateRangeISO(from, to) {
  const start = parseISODateLocal(from);
  const end = parseISODateLocal(to);
  const dates = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

function getTaskEmployeeIds(task) {
  const ids = [
    ...(Array.isArray(task.assignedEmployees) ? task.assignedEmployees : []),
    ...(Array.isArray(task.participants) ? task.participants : [])
  ];
  return [...new Set(ids.map(Number))];
}

function escapeCsv(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildReportRows(employeeId, from, to, shifts, tasks, employees, advances) {
  const NORM_MS = 8 * 3600 * 1000; // 8-часовая норма за смену
  const dates   = getDateRangeISO(from, to);
  const today   = getLocalISODate();
  const nowMs   = Date.now();

  const empList = (employeeId === "all" || employeeId == null)
    ? (employees || [])
    : (employees || []).filter(e => Number(e.id) === Number(employeeId));

  return empList.map(emp => {
    const empId = Number(emp.id);

    let daysWithShift    = 0;
    let daysWithoutShift = 0;
    let workedMs         = 0;
    let underMs          = 0;
    let overMs           = 0;
    let doneTasks        = 0;
    let pendingTasks     = 0;
    let ratingSum        = 0;
    let ratingCount      = 0;
    let mainDoneCount    = 0;
    let firstCreatedAt   = null;
    let lastCompletedAt  = null;
    const empTasks       = [];

    dates.forEach(date => {
      const empShifts = shifts.filter(s =>
        String(s.start_time || "").slice(0, 10) === date &&
        Number(s.employee_id) === empId
      );
      const dayTasks = tasks.filter(t =>
        t.date === date && getTaskEmployeeIds(t).includes(empId)
      );
      empTasks.push(...dayTasks);

      dayTasks.forEach(t => {
        if (t.status === "done") {
          doneTasks++;
          if (Array.isArray(t.assignedEmployees) && t.assignedEmployees.map(Number).includes(empId)) mainDoneCount++;
          if (t.rating != null && Number(t.rating) > 0) {
            ratingSum += Number(t.rating);
            ratingCount++;
          }
          if (t.completed_at) {
            if (!lastCompletedAt || t.completed_at > lastCompletedAt) lastCompletedAt = t.completed_at;
          }
        } else {
          pendingTasks++;
        }
        if (t.created_at) {
          if (!firstCreatedAt || t.created_at < firstCreatedAt) firstCreatedAt = t.created_at;
        }
      });

      if (empShifts.length > 0) {
        daysWithShift++;
        let dayWorkedMs = 0;
        empShifts.forEach(s => {
          const sMs = new Date(s.start_time).getTime();
          if (!Number.isFinite(sMs)) return;
          let eMs = sMs;
          if (s.end_time) {
            eMs = new Date(s.end_time).getTime();
          } else if (s.status === "open" && date === today) {
            eMs = nowMs;
          }
          if (Number.isFinite(eMs) && eMs > sMs) dayWorkedMs += eMs - sMs;
        });
        workedMs += dayWorkedMs;
        const diff = dayWorkedMs - NORM_MS;
        if (diff > 0) overMs  += diff;
        else          underMs += -diff;
      } else {
        daysWithoutShift++;
      }
    });

    const advTotal = (advances || [])
      .filter(a => {
        const inPeriod = (!from || a.date >= from) && (!to || a.date <= to);
        return inPeriod && Number(a.employee_id) === empId;
      })
      .reduce((s, a) => s + a.amount, 0);

    return {
      employeeId:    empId,
      employeeNames: emp.name,
      daysWithShift,
      daysWithoutShift,
      workedMs,
      worked:  formatDuration(workedMs),
      underMs,
      under:   formatDuration(underMs),
      overMs,
      over:    formatDuration(overMs),
      advTotal,
      doneTasks,
      pendingTasks,
      avgRating: (() => {
        const avgBase = ratingCount > 0 ? ratingSum / ratingCount : null;
        const r = calcCombinedRating(avgBase, doneTasks, mainDoneCount);
        return r !== null ? r.toFixed(1) : "—";
      })(),
      firstCreatedAt,
      lastCompletedAt,
      tasks: empTasks
    };
  });
}

function updateRepSummary(rows) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  if (!rows || !rows.length) {
    set("repCardOnShift",  "—");
    set("repCardOffShift", "—");
    set("repCardWorked",   "—");
    set("repCardUnder",    "—");
    set("repCardOver",     "—");
    set("repCardAdv",      "—");
    set("repCardDone",     "—");
    set("repCardPending",  "");
    set("repCardRating",   "—");
    return;
  }

  const totalOnShift   = rows.reduce((s, r) => s + r.daysWithShift, 0);
  const totalOffShift  = rows.reduce((s, r) => s + r.daysWithoutShift, 0);
  const totalWorkedMs  = rows.reduce((s, r) => s + r.workedMs, 0);
  const totalUnderMs   = rows.reduce((s, r) => s + r.underMs, 0);
  const totalOverMs    = rows.reduce((s, r) => s + r.overMs, 0);
  const totalAdv       = rows.reduce((s, r) => s + r.advTotal, 0);
  const totalDone      = rows.reduce((s, r) => s + r.doneTasks, 0);
  const totalPending   = rows.reduce((s, r) => s + r.pendingTasks, 0);

  set("repCardOnShift",  totalOnShift);
  set("repCardOffShift", totalOffShift);
  set("repCardWorked",   formatDuration(totalWorkedMs));
  set("repCardUnder",    formatDuration(totalUnderMs));
  set("repCardOver",     formatDuration(totalOverMs));
  set("repCardAdv",      Number(totalAdv).toLocaleString("ru-RU") + " TJS");
  set("repCardDone",     totalDone);
  set("repCardPending",  "Не выполнено: " + totalPending);
  // repCardRating перенесён в раздел «Зарплата»
}

function renderReportTable(rows, future = false) {
  updateRepSummary(future ? [] : rows);

  const tbody = document.querySelector("#reportTable tbody");
  if (!tbody) return;

  if (future) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#999;">Данные для будущего периода недоступны</td></tr>`;
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#999;">Нет данных за выбранный период</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${row.employeeNames}</td>
      <td>${row.daysWithShift}</td>
      <td>${row.daysWithoutShift}</td>
      <td>${row.worked}</td>
      <td>${row.under}</td>
      <td>${row.over}</td>
      <td>${Number(row.advTotal).toLocaleString("ru-RU")} TJS</td>
      <td>${row.doneTasks}</td>
      <td>${row.pendingTasks}</td>
      <td>${row.avgRating}</td>
      <td style="text-align:right; padding-right:16px;">
        <div style="display:flex;gap:6px;justify-content:flex-end;">
          <button class="btn reportShowDaysBtn" data-empid="${row.employeeId}">Дни</button>
          <button class="btn reportShowTasksBtn" data-empid="${row.employeeId}">Задачи</button>
        </div>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".reportShowTasksBtn").forEach(btn => {
    btn.addEventListener("click", () => openReportTasksModal(Number(btn.dataset.empid)));
  });
  document.querySelectorAll(".reportShowDaysBtn").forEach(btn => {
    btn.addEventListener("click", () => openShiftDaysModal(Number(btn.dataset.empid)));
  });
}


function openReportTasksModal(empId) {
  const row    = reportState.rows.find(r => r.employeeId === Number(empId));
  const allTasks = row ? row.tasks : [];
  const empMap   = reportState.empMap || {};

  const list    = document.getElementById("tasksList");
  const title   = document.getElementById("tasksModalTitle");
  const daysSel = document.getElementById("tiDaySelect");
  if (!list || !title || !daysSel) return;

  title.textContent   = `Задачи: ${row ? row.employeeNames : ""}`;
  title.style.display = "";

  // Строим опции по дням месяца из фильтра отчёта
  const pad         = n => String(n).padStart(2, "0");
  const mStr        = pad(_repMonth);
  const daysInMonth = new Date(_repYear, _repMonth, 0).getDate();

  daysSel.innerHTML = '<option value="">Все дни</option>';
  for (let d = 1; d <= daysInMonth; d++) {
    const val = `${_repYear}-${mStr}-${pad(d)}`;
    const lbl = `${pad(d)}.${mStr}.${_repYear}`;
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = lbl;
    daysSel.appendChild(opt);
  }
  daysSel.style.display = "";

  function renderFiltered() {
    const selectedDay = daysSel.value;
    const filtered = selectedDay
      ? allTasks.filter(t => t.date === selectedDay)
      : allTasks;
    renderTaskItems(list, filtered, empMap, { readOnly: true });
  }

  daysSel.onchange = renderFiltered;
  renderFiltered();

  document.getElementById("tasksModal").style.display = "flex";
}

/* ─── Модалка: смены по дням сотрудника ─────────────────────────── */
async function openShiftDaysModal(empId) {
  const modal = document.getElementById("shiftDaysModal");
  const body  = document.getElementById("shiftDaysModalBody");
  const title = document.getElementById("shiftDaysModalTitle");
  if (!modal || !body || !title) return;

  const row     = reportState.rows.find(r => r.employeeId === Number(empId));
  const empName = row ? row.employeeNames : ("Сотрудник #" + empId);
  const pad     = n => String(n).padStart(2, "0");
  const y = _repYear, m = _repMonth;

  title.textContent = empName;
  const sub = document.getElementById("shiftDaysModalSub");
  if (sub) sub.textContent = new Date(y, m - 1).toLocaleString("ru-RU", { month: "long", year: "numeric" });

  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);">Загрузка…</div>`;
  modal.style.display = "flex";

  const shifts = await fetchShifts();
  const prefix = `${y}-${pad(m)}`;
  // Локальный массив — мутируется при редактировании
  const empShifts = shifts.filter(s =>
    Number(s.employee_id) === Number(empId) &&
    String(s.start_time || "").startsWith(prefix)
  );

  const daysInMonth = new Date(y, m, 0).getDate();

  // Все смены конкретного дня (может быть несколько)
  function getShiftsForDay(dateISO) {
    return empShifts
      .filter(s => String(s.start_time || "").slice(0, 10) === dateISO)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  function shiftWorkedMs(shift) {
    const sMs = new Date(shift.start_time).getTime();
    if (!Number.isFinite(sMs)) return 0;
    let eMs;
    if (shift.end_time)          eMs = new Date(shift.end_time).getTime();
    else if (shift.status === "open") eMs = Date.now();
    else return 0;
    return Math.max(0, eMs - sMs);
  }

  function fmtMs(ms) {
    if (!ms) return "—";
    const h   = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    return `${h}:${pad(min)}`;
  }

  function toTimeValue(isoStr) {
    return isoStr ? String(isoStr).slice(11, 16) : "";
  }

  // Уникальный id для row инпутов — по id смены
  function editRowId(shiftId) { return `sdmEdit_${shiftId}`; }

  function renderTable() {
    let html = `
      <table class="sdm-table">
        <colgroup>
          <col class="sdm-col-date">
          <col class="sdm-col-time">
          <col class="sdm-col-time">
          <col class="sdm-col-worked">
          <col class="sdm-col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>Дата / интервал</th>
            <th>Начало</th>
            <th>Конец</th>
            <th>Отработано</th>
            <th style="text-align:right;">Действия</th>
          </tr>
        </thead>
        <tbody>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateISO  = `${y}-${pad(m)}-${pad(d)}`;
      const dayObj   = new Date(y, m - 1, d);
      const wd       = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"][dayObj.getDay()];
      const dateRu   = `${pad(d)}.${pad(m)}.${y}`;
      const dayShifts = getShiftsForDay(dateISO);
      const totalMs  = dayShifts.reduce((s, sh) => s + shiftWorkedMs(sh), 0);
      const hasShifts = dayShifts.length > 0;

      // Строка-заголовок дня: 3 колонки даты + итого + действия
      html += `<tr class="sdm-day-header${hasShifts ? "" : " sdm-row--empty"}" data-date="${dateISO}">
        <td colspan="3"><strong>${wd}</strong> ${dateRu}</td>
        <td class="sdm-worked">${hasShifts ? fmtMs(totalMs) : "—"}</td>
        <td class="sdm-cell-actions">
          <button class="sdm-btn-add" data-date="${dateISO}">Изменить</button>
        </td>
      </tr>`;

      if (hasShifts) {
        dayShifts.forEach(shift => {
          const isOpen   = !shift.end_time;
          const startVal = toTimeValue(shift.start_time);
          const endVal   = toTimeValue(shift.end_time);
          const worked   = fmtMs(shiftWorkedMs(shift));
          html += `<tr class="sdm-shift-row${isOpen ? " sdm-row--open" : ""}" data-shiftid="${shift.id}" data-date="${dateISO}" id="${editRowId(shift.id)}">
            <td class="sdm-cell-label">интервал</td>
            <td class="sdm-cell-start">${startVal || '<span style="color:var(--muted)">—</span>'}</td>
            <td class="sdm-cell-end">${endVal || (isOpen
              ? '<span style="color:var(--accent);font-size:11px;">в работе</span>'
              : '<span style="color:var(--muted)">—</span>')}</td>
            <td class="sdm-worked">${worked}</td>
            <td class="sdm-cell-actions">
              <button class="sdm-btn-edit" data-shiftid="${shift.id}" data-date="${dateISO}">Изменить</button>
            </td>
          </tr>`;
        });
      }
    }

    html += `</tbody></table>`;
    // Зачищаем обработчик "вне строки" от предыдущего редактирования
    if (body._sdmOnOutside) {
      body.removeEventListener("mousedown", body._sdmOnOutside);
      body._sdmOnOutside = null;
    }
    body.innerHTML = html;

    body.querySelectorAll(".sdm-btn-edit").forEach(btn => {
      btn.addEventListener("click", () => startEditShift(btn.dataset.shiftid, btn.dataset.date));
    });
    body.querySelectorAll(".sdm-btn-add").forEach(btn => {
      btn.addEventListener("click", () => startAddShift(btn.dataset.date));
    });
  }

  // Редактирование существующего интервала
  function startEditShift(shiftId, dateISO) {
    // Отменяем любое активное редактирование (перерисовывает таблицу)
    if (body._sdmOnOutside) {
      body.removeEventListener("mousedown", body._sdmOnOutside);
      body._sdmOnOutside = null;
      renderTable();
    }

    const tr = body.querySelector(`#${editRowId(shiftId)}`);
    if (!tr) return;
    const shift    = empShifts.find(s => String(s.id) === String(shiftId));
    const startVal = toTimeValue(shift?.start_time) || "";
    const endVal   = toTimeValue(shift?.end_time)   || "";

    tr.classList.add("sdm-row--editing");
    tr.querySelector(".sdm-cell-start").innerHTML =
      `<input class="sdm-time-inp" id="sdmS_${shiftId}" type="time" value="${startVal}">`;
    tr.querySelector(".sdm-cell-end").innerHTML =
      `<input class="sdm-time-inp" id="sdmE_${shiftId}" type="time" value="${endVal}">`;
    tr.querySelector(".sdm-worked").textContent = "";
    tr.querySelector(".sdm-cell-actions").innerHTML =
      `<button class="sdm-btn-save" data-shiftid="${shiftId}" data-date="${dateISO}">Сохранить</button>`;

    tr.querySelector(".sdm-btn-save").addEventListener("click", () => {
      body.removeEventListener("mousedown", body._sdmOnOutside);
      body._sdmOnOutside = null;
      saveShift(shiftId, dateISO);
    });

    function onOutside(e) {
      if (!tr.contains(e.target)) {
        body.removeEventListener("mousedown", onOutside);
        body._sdmOnOutside = null;
        renderTable();
      }
    }
    body._sdmOnOutside = onOutside;
    // setTimeout чтобы клик, открывший редактирование, не закрыл его сразу
    setTimeout(() => body.addEventListener("mousedown", onOutside), 0);
  }

  // Добавление нового интервала — inline в строке дня
  function startAddShift(dateISO) {
    // Отменяем любое активное редактирование
    if (body._sdmOnOutside) {
      body.removeEventListener("mousedown", body._sdmOnOutside);
      body._sdmOnOutside = null;
      renderTable();
    }

    const headerRow = body.querySelector(`tr.sdm-day-header[data-date="${dateISO}"]`);
    if (!headerRow) return;

    // Переводим строку дня в режим редактирования
    headerRow.classList.add("sdm-row--editing");
    const uid = `new_${dateISO}`;

    // Оригинальная структура: [td colspan=3 дата] [td worked] [td actions]
    const tds = headerRow.querySelectorAll("td");
    // tds[0] = дата (colspan=3), tds[1] = отработано, tds[2] = действия

    // Сжимаем дату до 1 колонки, вставляем 2 инпута после неё
    tds[0].colSpan = 1;
    const tdStart = document.createElement("td");
    tdStart.className = "sdm-cell-start";
    tdStart.innerHTML = `<input class="sdm-time-inp" id="sdmS_${uid}" type="time">`;
    const tdEnd = document.createElement("td");
    tdEnd.className = "sdm-cell-end";
    tdEnd.innerHTML = `<input class="sdm-time-inp" id="sdmE_${uid}" type="time">`;
    tds[0].after(tdStart);
    tdStart.after(tdEnd);

    tds[1].textContent = "";
    tds[2].innerHTML =
      `<button class="sdm-btn-save sdm-btn-add-save" data-date="${dateISO}">Сохранить</button>`;

    headerRow.querySelector(".sdm-btn-add-save").addEventListener("click", () => {
      body.removeEventListener("mousedown", body._sdmOnOutside);
      body._sdmOnOutside = null;
      saveNewShift(dateISO, uid);
    });

    function onOutside(e) {
      if (!headerRow.contains(e.target)) {
        body.removeEventListener("mousedown", onOutside);
        body._sdmOnOutside = null;
        renderTable();
      }
    }
    body._sdmOnOutside = onOutside;
    setTimeout(() => body.addEventListener("mousedown", onOutside), 0);
  }

  async function saveShift(shiftId, dateISO) {
    const startVal = document.getElementById(`sdmS_${shiftId}`)?.value;
    const endVal   = document.getElementById(`sdmE_${shiftId}`)?.value || "";
    if (!startVal) {
      const inp = document.getElementById(`sdmS_${shiftId}`);
      if (inp) inp.style.borderColor = "#e74c3c";
      return;
    }
    const startISO = `${dateISO}T${startVal}:00`;
    const endISO   = endVal ? `${dateISO}T${endVal}:00` : null;
    try {
      await fetch(`${API}/api/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: startISO, end_time: endISO })
      });
      const idx = empShifts.findIndex(s => String(s.id) === String(shiftId));
      if (idx !== -1) Object.assign(empShifts[idx], {
        start_time: startISO, end_time: endISO, status: endISO ? "closed" : "open"
      });
    } catch (e) { console.error("Ошибка сохранения:", e); }
    renderTable(); generateReport();
    invalidateEmployeeCache(); refreshEmployees();
  }

  async function saveNewShift(dateISO, uid) {
    const startVal = document.getElementById(`sdmS_${uid}`)?.value;
    const endVal   = document.getElementById(`sdmE_${uid}`)?.value || "";
    if (!startVal) {
      const inp = document.getElementById(`sdmS_${uid}`);
      if (inp) inp.style.borderColor = "#e74c3c";
      return;
    }
    const startISO = `${dateISO}T${startVal}:00`;
    const endISO   = endVal ? `${dateISO}T${endVal}:00` : null;
    try {
      const res  = await fetch(`${API}/api/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: empId, start_time: startISO, end_time: endISO })
      });
      const data = await res.json();
      empShifts.push({ id: data.id, employee_id: Number(empId),
        start_time: startISO, end_time: endISO, status: endISO ? "closed" : "open" });
    } catch (e) { console.error("Ошибка добавления:", e); }
    renderTable(); generateReport();
    invalidateEmployeeCache(); refreshEmployees();
  }

  async function deleteShift(shiftId) {
    if (!shiftId) return;
    try {
      await fetch(`${API}/api/shifts/${shiftId}`, { method: "DELETE" });
      const idx = empShifts.findIndex(s => String(s.id) === String(shiftId));
      if (idx !== -1) empShifts.splice(idx, 1);
    } catch (e) { console.error("Ошибка удаления:", e); }
    renderTable(); generateReport();
    invalidateEmployeeCache(); refreshEmployees();
  }

  renderTable();
}

(function initShiftDaysModal() {
  const modal     = document.getElementById("shiftDaysModal");
  const closeBtn  = document.getElementById("shiftDaysModalClose");
  const cancelBtn = document.getElementById("shiftDaysModalCancel");
  if (!modal) return;
  const close = () => { modal.style.display = "none"; };
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
})();

async function loadReportEmployees() {
  const select = document.getElementById("reportEmployee");
  if (!select) return;

  const prev = select.value || "all";
  const employees = await fetchEmployees();
  const options = employees
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"))
    .map(emp => `<option value="${emp.id}">${escapeHtml(emp.name)}</option>`)
    .join("");

  select.innerHTML = `<option value="all">\u0412\u0441\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438</option>${options}`;
  // restore previous selection if still valid
  if (prev && (prev === "all" || employees.some(e => String(e.id) === prev))) {
    select.value = prev;
  } else {
    select.value = "all";
  }
}


async function generateReport() {
  const empSelect = document.getElementById("reportEmployee");
  if (!empSelect) return;

  await loadReportEmployees();
  const selectedEmployee = empSelect.value;
  const employeeId = selectedEmployee === "all" ? "all" : Number(selectedEmployee);
  const { from, to } = getMonthRange(_repYear, _repMonth);

  reportState.employeeId   = employeeId;
  reportState.employeeName = empSelect.options[empSelect.selectedIndex]?.text || "";
  reportState.from = from;
  reportState.to   = to;

  if (isRepFuturePeriod()) {
    reportState.rows   = [];
    reportState.empMap = {};
    renderReportTable([], true);
    return;
  }

  const [shifts, tasks, employees, allAdv] = await Promise.all([
    fetchShifts(), fetchTasks(), fetchEmployees(),
    fetch(API + "/api/advances").then(r => r.json()).catch(() => [])
  ]);
  const rows = buildReportRows(employeeId, from, to, shifts, tasks, employees, allAdv);

  const empMap = {};
  employees.forEach(e => { empMap[e.id] = e.name; });

  reportState.rows   = rows;
  reportState.empMap = empMap;

  renderReportTable(rows);
}

function exportReportCsv() {
  if (!reportState.rows.length) {
    alert("\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u0444\u043e\u0440\u043c\u0438\u0440\u0443\u0439\u0442\u0435 \u043e\u0442\u0447\u0451\u0442");
    return;
  }

  const header = ["Сотрудник", "Дней на смене", "Дней вне смены", "Отработано", "Недоработано", "Переработано", "Аванс", "Выполнено задач", "Не выполнено", "Ср. рейтинг"];
  const lines = [header.join(",")];

  reportState.rows.forEach(row => {
    lines.push([
      escapeCsv(row.employeeNames),
      escapeCsv(row.daysWithShift),
      escapeCsv(row.daysWithoutShift),
      escapeCsv(row.worked),
      escapeCsv(row.under),
      escapeCsv(row.over),
      escapeCsv(Number(row.advTotal).toLocaleString("ru-RU") + " TJS"),
      escapeCsv(row.doneTasks),
      escapeCsv(row.pendingTasks),
      escapeCsv(row.avgRating)
    ].join(","));
  });

  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report_${reportState.employeeName || "employee"}_${reportState.from}_${reportState.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printReport() {
  if (!reportState.rows.length) {
    alert("Сначала сформируйте отчёт");
    return;
  }

  const g = id => document.getElementById(id)?.textContent?.trim() || "—";

  const cardsHtml = `
    <div class="cards">
      <div class="card"><div class="val">${g("repCardOnShift")}</div><div class="lbl">Дней на смене</div></div>
      <div class="card"><div class="val">${g("repCardOffShift")}</div><div class="lbl">Дней вне смены</div></div>
      <div class="card"><div class="val">${g("repCardWorked")}</div><div class="lbl">Отработано</div></div>
      <div class="card"><div class="val">${g("repCardUnder")}</div><div class="lbl">Недоработано</div></div>
      <div class="card"><div class="val">${g("repCardOver")}</div><div class="lbl">Переработано</div></div>
      <div class="card"><div class="val">${g("repCardAdv")}</div><div class="lbl">Аванс</div></div>
      <div class="card"><div class="val">${g("repCardDone")}</div><div class="lbl">Выполнено задач</div></div>
    </div>`;

  const rowsHtml = reportState.rows.map(row => `
    <tr>
      <td>${row.employeeNames}</td>
      <td>${row.daysWithShift}</td>
      <td>${row.daysWithoutShift}</td>
      <td>${row.worked}</td>
      <td>${row.under}</td>
      <td>${row.over}</td>
      <td>${Number(row.advTotal).toLocaleString("ru-RU")} TJS</td>
      <td>${row.doneTasks}</td>
      <td>${row.pendingTasks}</td>
      <td>${row.avgRating}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Отчёт — ${reportState.employeeName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Arial, sans-serif; font-size: 13px;
           background: #0e1117; color: #e5e9f0; padding: 24px; }
    h2  { font-size: 17px; font-weight: 600; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #9aa0ac; margin-bottom: 18px; }
    .cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
    .card { background: #11151c; border: 1px solid #1f2530; border-radius: 8px;
            padding: 12px 16px; min-width: 110px; }
    .val  { font-size: 18px; font-weight: 700; color: #e5e9f0; }
    .lbl  { font-size: 11px; color: #9aa0ac; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #131820; color: #9aa0ac; font-size: 11px;
               font-weight: 600; text-transform: uppercase; letter-spacing: .4px;
               padding: 9px 10px; text-align: left; border-bottom: 1px solid #1f2530; }
    tbody td { padding: 9px 10px; border-bottom: 1px solid #1a1f29;
               color: #e5e9f0; }
    tbody tr:last-child td { border-bottom: none; }
    @media print {
      body { background: #fff; color: #111; padding: 0; }
      .card { background: #f4f4f4; border-color: #ccc; }
      .val  { color: #111; }
      .lbl  { color: #555; }
      thead th { background: #eee; color: #333; border-color: #ccc; }
      tbody td { border-color: #ddd; color: #111; }
    }
  </style>
</head>
<body>
  <h2>Отчёт: ${reportState.employeeName}</h2>
  <div class="sub">Период: ${formatDateRu(reportState.from)} — ${formatDateRu(reportState.to)}</div>
  ${cardsHtml}
  <table>
    <thead>
      <tr>
        <th>Сотрудник</th>
        <th>Дней на смене</th>
        <th>Дней вне смены</th>
        <th>Отработано</th>
        <th>Недоработано</th>
        <th>Переработано</th>
        <th>Аванс</th>
        <th>Выполнено</th>
        <th>Не выполнено</th>
        <th>Ср. рейтинг</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

  // Скрытый iframe — не требует разрешения на popup, работает во всех браузерах
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Ждём полной отрисовки перед print()
  iframe.contentWindow.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    // Убираем iframe после закрытия диалога печати
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  // Fallback: если onload уже сработал до назначения обработчика
  if (iframe.contentDocument.readyState === "complete") {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }
}

async function initReportSection() {
  const empSelect = document.getElementById("reportEmployee");
  const printBtn  = document.getElementById("reportPrint");
  if (!empSelect || !printBtn) return;

  await loadReportEmployees();
  updateReportMonthLabel();

  const repDrop   = document.getElementById("reportMonthDropdown");
  const repToggle = document.getElementById("reportMonthToggle");
  const repMenu   = document.getElementById("reportMonthMenu");

  if (repToggle) {
    repToggle.addEventListener("click", e => {
      e.stopPropagation();
      repDrop?.classList.toggle("open");
      if (repDrop?.classList.contains("open")) renderReportMonthMenu();
    });
    repMenu?.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", e => {
      if (repDrop && !repDrop.contains(e.target)) repDrop.classList.remove("open");
    });
  }

  empSelect.addEventListener("change", generateReport);
  printBtn.addEventListener("click", printReport);

  // ── Перезагрузка отчёта при открытии раздела ────────────────────────
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.section === "report") generateReport();
    });
  });

  // ── SSE: обновлять отчёт если раздел открыт ─────────────────────────
  const _repDebounce = debounce(() => {
    if (document.getElementById("report")?.classList.contains("active")) generateReport();
  }, 600);
  document.addEventListener("sseEmployees", _repDebounce);
  document.addEventListener("sseTasks",     _repDebounce);

  await generateReport();
}
(async function init() {
  await refreshTaskDateSelector(true);
  restoreAddTaskModalHandlers();
  await initReportSection();
})();




/* =====================================================================
   РАЗДЕЛ «ЗАРПЛАТА»
   ===================================================================== */
(function initSalary() {
  const HOURS_NORM = 260; // норма часов в месяц

  const _now = new Date();
  let _filterYear  = _now.getFullYear();
  let _filterMonth = _now.getMonth() + 1;

  let _employees = [];
  let _shifts    = [];
  let _advances  = [];
  let _settings  = [];
  let _payments  = [];
  let _tasks     = [];

  const fmtH2  = h => Number(h || 0).toFixed(2).replace(".", ",");
  const fmtH   = h => Number(h || 0).toFixed(1).replace(".", ",");
  const fmtAmt = n => Number(n || 0).toLocaleString("ru-RU") + " TJS";
  const fmtDate= s => { if (!s) return "—"; const p = s.slice(0,10).split("-"); return `${p[2]}.${p[1]}.${p[0]}`; };

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function monthPrefix() {
    return `${_filterYear}-${String(_filterMonth).padStart(2,"0")}`;
  }

  // ── Расчёт строки одного сотрудника ─────────────────────────────────
  function calcRow(emp) {
    const prefix  = monthPrefix();
    const setting = _settings.find(s => s.employee_id === emp.id) || {};
    const normH   = HOURS_NORM;

    // Для будущего периода — только норма, всё остальное 0
    if (isFuturePeriod()) {
      return { emp, monthlySalary: 0, normH, rate: 0, workedH: 0, overH: 0, underH: 0, overAmt: 0, salary: 0, advTotal: 0, payTotal: 0, balance: 0 };
    }

    const monthlySalary = Number(setting.salary) || 0;
    const rate          = (monthlySalary > 0 && normH > 0) ? monthlySalary / normH : 0;

    const nowMs = Date.now();
    let workedMs = 0;
    _shifts
      .filter(s => s.employee_id === emp.id && (s.start_time || "").startsWith(prefix))
      .forEach(s => {
        const startMs = new Date(s.start_time).getTime();
        if (!Number.isFinite(startMs)) return;
        const endMs = s.end_time
          ? new Date(s.end_time).getTime()
          : (s.status === "open" ? nowMs : startMs);
        if (endMs > startMs) workedMs += endMs - startMs;
      });
    const workedH = workedMs / 3600000;
    const overH   = Math.max(0, workedH - normH);
    const underH  = Math.max(0, normH - workedH);
    const salary  = monthlySalary;

    const advTotal = _advances
      .filter(a => a.employee_id === emp.id && (a.date || "").startsWith(prefix))
      .reduce((s, a) => s + Number(a.amount), 0);

    const payTotal = _payments
      .filter(p => p.employee_id === emp.id && (p.date || "").startsWith(prefix))
      .reduce((s, p) => s + Number(p.amount), 0);

    const overAmt = rate * overH;
    const balance = salary - advTotal - payTotal;
    return { emp, monthlySalary, normH, rate, workedH, overH, underH, overAmt, salary, advTotal, payTotal, balance };
  }

  // ── Сводные карточки ─────────────────────────────────────────────────
  function renderSummary(rows) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const sum = fn => rows.reduce((acc, r) => acc + fn(r), 0);
    set("salCardCount",   rows.length);
    set("salCardEarned",  fmtAmt(sum(r => r.salary)));
    set("salCardAdv",     fmtAmt(sum(r => r.advTotal)));
    set("salCardBalance", fmtAmt(sum(r => r.salary) - sum(r => r.payTotal) - sum(r => r.advTotal)));
    set("salCardOverAmt", fmtAmt(Math.round(sum(r => r.overAmt))));
  }

  // ── Заполнение списка сотрудников ────────────────────────────────────
  function populateEmpSelect() {
    const sel = document.getElementById("salEmpSelect");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Все сотрудники</option>` +
      _employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
    // Восстановить выбор если сотрудник ещё есть
    if (current && _employees.some(e => String(e.id) === current)) sel.value = current;
  }



  // ── Таблица сотрудников ──────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById("salTableBody");
    if (!tbody) return;

    const selId   = Number(document.getElementById("salEmpSelect")?.value) || 0;
    const allRows = _employees.map(calcRow);
    renderSummary(selId ? allRows.filter(r => r.emp.id === selId) : allRows);

    const rows = selId ? allRows.filter(r => r.emp.id === selId) : allRows;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="sal-empty">Нет сотрудников</td></tr>`;
      return;
    }

    const future = isFuturePeriod();
    tbody.innerHTML = rows.map(r => {
      const overCls  = r.overH > 0.05 ? "sal-over" : "sal-zero";
      const balCls   = r.balance < -0.5 ? "sal-under" : r.balance < 0.5 ? "sal-over" : "";
      const empName  = escapeHtml(r.emp.name);
      const muted    = `<span class="sal-muted">—</span>`;
      return `<tr>
        <td class="sal-name">${empName}</td>
        <td class="sal-num">${fmtH(r.normH)}</td>
        <td class="sal-num">${future ? muted : fmtH(r.workedH)}</td>
        <td class="sal-num ${future ? "" : (r.underH > 0.05 ? "sal-under" : "")}">${future ? muted : fmtH(r.underH)}</td>
        <td class="sal-num ${future ? "" : overCls}">${future ? muted : (r.overH > 0.05 ? "+" + fmtH(r.overH) : fmtH(r.overH))}</td>
        <td class="sal-num ${future ? "" : (r.overAmt > 0.5 ? "sal-over" : "")}">${future ? muted : fmtAmt(Math.round(r.overAmt))}</td>
        <td class="sal-num">${future ? muted : fmtH2(r.rate) + " TJS"}</td>
        <td class="sal-num">${future ? muted : fmtAmt(r.advTotal)}</td>
        <td class="sal-num sal-bold">${future ? muted : fmtAmt(r.salary)}</td>
        <td class="sal-num sal-bold ${future ? "" : balCls}">${future ? muted : fmtAmt(r.balance)}</td>
        <td>
          <div class="sal-actions">
            <button class="sal-act-btn sal-act-hist" data-id="${r.emp.id}" data-name="${empName}" title="История">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/></svg>
              История
            </button>
          </div>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll(".sal-act-hist").forEach(b => b.onclick = () => openHistModal(Number(b.dataset.id), b.dataset.name));
    applySalFutureState();
  }

  // ── Блокировка будущего периода ──────────────────────────────────────
  function isFuturePeriod() {
    const nowYear  = _now.getFullYear();
    const nowMonth = _now.getMonth() + 1;
    return _filterYear > nowYear || (_filterYear === nowYear && _filterMonth > nowMonth);
  }

  function applySalFutureState() {
    const future    = isFuturePeriod();
    const tableWrap = document.querySelector("#salary .sal-table-wrap");
    const summary   = document.querySelector("#salary .sal-summary");
    const advBtn    = document.getElementById("salAdvBtn");
    const settBtn   = document.getElementById("salSettingsBtn");

    let msg = document.getElementById("salFutureMsg");
    if (!msg) {
      msg = document.createElement("div");
      msg.id = "salFutureMsg";
      msg.className = "sal-future-msg";
      msg.textContent = "Данные для будущего периода недоступны";
      if (tableWrap) tableWrap.parentNode.insertBefore(msg, tableWrap);
    }

    tableWrap?.classList.toggle("disabled", future);
    summary?.classList.toggle("disabled", future);
    msg.style.display = future ? "block" : "none";
    if (advBtn)  advBtn.disabled  = future;
    if (settBtn) settBtn.disabled = future;
  }

  // ── Загрузка данных ──────────────────────────────────────────────────
  async function loadAll() {
    const [emps, allShifts, allAdvances, settings, payments, allTasks] = await Promise.all([
      fetchEmployees(),
      fetch(API + "/api/shifts").then(r => r.json()).catch(() => []),
      fetch(API + "/api/advances").then(r => r.json()).catch(() => []),
      fetch(`${API}/api/salary/settings?year=${_filterYear}&month=${_filterMonth}`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/salary/payments?year=${_filterYear}&month=${_filterMonth}`).then(r => r.json()).catch(() => []),
      fetchTasks(),
    ]);
    _employees = emps.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    _shifts    = allShifts;
    _advances  = allAdvances;
    _settings  = settings;
    _payments  = payments;
    _tasks     = allTasks;
    populateEmpSelect();
    renderTable();
  }

  // ── Кастомный выбор месяца (стиль calendar-dropdown как в «Заданиях») ──
  const SAL_MONTHS = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

  const salMonthDropdown = document.getElementById("salMonthDropdown");
  const salMonthToggle   = document.getElementById("salMonthToggle");
  const salMonthMenu     = document.getElementById("salMonthMenu");

  function updateSalMonthLabel() {
    if (salMonthToggle) {
      salMonthToggle.textContent = `${SAL_MONTHS[_filterMonth - 1]} ${_filterYear} ▼`;
    }
  }

  function renderSalMonthMenu() {
    if (!salMonthMenu) return;
    salMonthMenu.innerHTML = "";

    // Заголовок с навигацией по годам
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);";
    header.innerHTML = `
      <span data-dir="-1" style="cursor:pointer;padding:2px 8px;font-size:13px;color:var(--muted);">◀</span>
      <span style="font-weight:600;font-size:13px;">${_filterYear}</span>
      <span data-dir="1"  style="cursor:pointer;padding:2px 8px;font-size:13px;color:var(--muted);">▶</span>
    `;
    salMonthMenu.appendChild(header);

    // Сетка месяцев
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:6px;";

    SAL_MONTHS.forEach((name, i) => {
      const m = i + 1;
      const cell = document.createElement("div");
      cell.textContent = name;
      cell.className = "day";
      cell.style.cssText = "text-align:center;border-radius:5px;";
      if (m === _filterMonth) {
        cell.style.background = "var(--accent)";
        cell.style.color = "#fff";
        cell.style.borderRadius = "5px";
      }
      cell.addEventListener("click", () => {
        _filterMonth = m;
        updateSalMonthLabel();
        salMonthDropdown?.classList.remove("open");
        loadAll();
      });
      grid.appendChild(cell);
    });
    salMonthMenu.appendChild(grid);

    // Навигация по годам
    header.querySelectorAll("[data-dir]").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _filterYear += Number(btn.dataset.dir);
        renderSalMonthMenu();
      });
    });
  }

  if (salMonthToggle) {
    updateSalMonthLabel();
    salMonthToggle.addEventListener("click", e => {
      e.stopPropagation();
      salMonthDropdown?.classList.toggle("open");
      if (salMonthDropdown?.classList.contains("open")) renderSalMonthMenu();
    });
    salMonthMenu?.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", e => {
      if (salMonthDropdown && !salMonthDropdown.contains(e.target)) {
        salMonthDropdown.classList.remove("open");
      }
    });
  }

  // ── Фильтр по сотруднику ─────────────────────────────────────────────
  document.getElementById("salEmpSelect")?.addEventListener("change", () => renderTable());

  // ── Модалка «Зарплата и норма» ───────────────────────────────────────
  let _rateEmpId = null;
  const rateModal = document.getElementById("salRateModal");

  function _fillRateEmpSel(empId) {
    const sel = document.getElementById("salRateEmpSel");
    if (!sel) return;
    sel.innerHTML = `<option value="">Выберите сотрудника</option>` +
      _employees.map(e =>
        `<option value="${e.id}"${e.id === empId ? " selected" : ""}>${escapeHtml(e.name)}</option>`
      ).join("");
  }

  function _clearRateErrors() {
    const empErr = document.getElementById("salRateEmpErr");
    const salErr = document.getElementById("salRateSalErr");
    if (empErr) { empErr.textContent = ""; empErr.classList.remove("visible"); }
    if (salErr) { salErr.textContent = ""; salErr.classList.remove("visible"); }
  }

  function _loadRateFields(empId) {
    const setting = _settings.find(s => s.employee_id === empId) || {};
    const salInp  = document.getElementById("salSalaryInput");
    if (salInp) salInp.value = setting.salary ?? "";
  }

  function openRateModal(empId) {
    _rateEmpId = empId;
    _fillRateEmpSel(empId);
    _loadRateFields(empId);
    _clearRateErrors();
    if (rateModal) rateModal.style.display = "flex";
    setTimeout(() => document.getElementById("salSalaryInput")?.focus(), 80);
  }
  function closeRateModal() { if (rateModal) rateModal.style.display = "none"; _rateEmpId = null; }

  document.getElementById("salRateEmpSel")?.addEventListener("change", function() {
    _rateEmpId = Number(this.value) || null;
    _loadRateFields(_rateEmpId);
    _clearRateErrors();
  });

  document.getElementById("salRateClose")?.addEventListener("click", closeRateModal);
  document.getElementById("salRateCancelBtn")?.addEventListener("click", closeRateModal);
  rateModal?.addEventListener("click", e => { if (e.target === rateModal) closeRateModal(); });

  document.getElementById("salRateSaveBtn")?.addEventListener("click", async () => {
    const empErr = document.getElementById("salRateEmpErr");
    const salErr = document.getElementById("salRateSalErr");
    const salary = parseFloat(document.getElementById("salSalaryInput")?.value) || 0;
    let ok = true;

    if (!_rateEmpId) {
      if (empErr) { empErr.textContent = "Выберите сотрудника"; empErr.classList.add("visible"); }
      ok = false;
    } else if (empErr) { empErr.textContent = ""; empErr.classList.remove("visible"); }

    if (!salary || salary <= 0) {
      if (salErr) { salErr.textContent = "Введите сумму зарплаты"; salErr.classList.add("visible"); }
      ok = false;
    } else if (salErr) { salErr.textContent = ""; salErr.classList.remove("visible"); }

    if (!ok) return;
    const emp = _employees.find(e => e.id === _rateEmpId);
    const confirmed = await new Promise(resolve => {
      confirmDelete(
        () => resolve(true),
        {
          title: "Сохранить настройки?",
          text: `${emp?.name || "Сотрудник"}: зарплата ${salary} TJS, норма ${HOURS_NORM} ч`,
          okLabel: "Сохранить"
        }
      );
      document.getElementById("confirmDelCancel")?.addEventListener("click", () => resolve(false), { once: true });
    });
    if (!confirmed) return;
    await fetch(API + "/api/salary/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: _rateEmpId, year: _filterYear, month: _filterMonth, salary, norm_hours: HOURS_NORM })
    });
    closeRateModal();
    await loadAll();
  });

  // ── Модалка «Аванс» (общая, с выбором сотрудника) ───────────────────
  const advModal = document.getElementById("salAdvModal");

  function fillAdvEmpSel(preselect) {
    const sel = document.getElementById("salAdvEmpSel");
    if (!sel) return;
    sel.innerHTML = `<option value="">— выберите сотрудника —</option>` +
      _employees.map(e => `<option value="${e.id}"${e.id === preselect ? " selected" : ""}>${escapeHtml(e.name)}</option>`).join("");
  }

  function openAdvModal() {
    fillAdvEmpSel(null);
    const amtInp  = document.getElementById("salAdvAmount");
    const dateInp = document.getElementById("salAdvDate");
    const cmmInp  = document.getElementById("salAdvComment");
    const amtErr  = document.getElementById("salAdvAmtErr");
    const empErr  = document.getElementById("salAdvEmpErr");
    if (amtInp)  amtInp.value  = "";
    if (dateInp) dateInp.value = todayISO();
    if (cmmInp)  cmmInp.value  = "";
    [amtErr, empErr].forEach(el => el && (el.textContent = "", el.classList.remove("visible")));
    if (advModal) advModal.style.display = "flex";
    setTimeout(() => document.getElementById("salAdvEmpSel")?.focus(), 80);
  }
  function closeAdvModal() {
    if (advModal) advModal.style.display = "none";
    _advSaving = false;
    const saveBtn = document.getElementById("salAdvSaveBtn");
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Сохранить"; }
  }

  document.getElementById("salAdvBtn")?.addEventListener("click", openAdvModal);

  document.getElementById("salSettingsBtn")?.addEventListener("click", () => {
    openRateModal(null);
  });
  document.getElementById("salAdvClose")?.addEventListener("click", closeAdvModal);
  document.getElementById("salAdvCancelBtn")?.addEventListener("click", closeAdvModal);
  advModal?.addEventListener("click", e => { if (e.target === advModal) closeAdvModal(); });

  let _advSaving = false;
  document.getElementById("salAdvSaveBtn")?.addEventListener("click", async () => {
    if (_advSaving) return;

    const empSel  = document.getElementById("salAdvEmpSel");
    const amtInp  = document.getElementById("salAdvAmount");
    const empErr  = document.getElementById("salAdvEmpErr");
    const amtErr  = document.getElementById("salAdvAmtErr");
    const saveBtn = document.getElementById("salAdvSaveBtn");
    let ok = true;

    const empId  = Number(empSel?.value);
    const amount = parseFloat(amtInp?.value);

    if (!empId) {
      if (empErr) { empErr.textContent = "Выберите сотрудника"; empErr.classList.add("visible"); }
      ok = false;
    } else if (empErr) { empErr.textContent = ""; empErr.classList.remove("visible"); }

    if (!amount || amount <= 0) {
      if (amtErr) { amtErr.textContent = "Введите сумму"; amtErr.classList.add("visible"); }
      if (ok) amtInp?.focus();
      ok = false;
    } else if (amtErr) { amtErr.textContent = ""; amtErr.classList.remove("visible"); }

    if (!ok) return;

    _advSaving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Сохранение…"; }

    try {
      await fetch(API + "/api/advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: empId,
          amount,
          date:    document.getElementById("salAdvDate")?.value    || todayISO(),
          comment: document.getElementById("salAdvComment")?.value?.trim() || ""
        })
      });
      closeAdvModal();
      await loadAll();
    } finally {
      _advSaving = false;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Сохранить"; }
    }
  });

  // ── Модалка «История выплат» ─────────────────────────────────────────
  const histModal = document.getElementById("salHistModal");

  function openHistModal(empId, name) {
    const nameEl = document.getElementById("salHistEmpName");
    if (nameEl) nameEl.textContent = name || "";
    renderHistBody(empId);
    if (histModal) histModal.style.display = "flex";
  }
  function closeHistModal() { if (histModal) histModal.style.display = "none"; }

  document.getElementById("salHistClose")?.addEventListener("click", closeHistModal);
  document.getElementById("salHistCloseFoot")?.addEventListener("click", closeHistModal);
  histModal?.addEventListener("click", e => { if (e.target === histModal) closeHistModal(); });

  function renderHistBody(empId) {
    const tbody = document.getElementById("salHistBody");
    if (!tbody) return;
    const prefix = monthPrefix();

    const combined = [
      ..._advances.filter(a => a.employee_id === empId && (a.date || "").startsWith(prefix)).map(a => ({ ...a, _type: "adv" })),
      ..._payments.filter(p => p.employee_id === empId && (p.date || "").startsWith(prefix)).map(p => ({ ...p, _type: "pay" }))
    ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    if (!combined.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="sal-empty">За выбранный период записей нет</td></tr>`;
      return;
    }

    const editSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const delSvg  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>`;

    tbody.innerHTML = combined.map(item => {
      return `<tr>
        <td>${fmtDate(item.date)}</td>
        <td class="sal-bold">${fmtAmt(item.amount)}</td>
        <td style="color:var(--muted)">${escapeHtml(item.comment || "—")}</td>
        <td style="white-space:nowrap">
          <button class="adv-del-btn hist-edit-btn" data-id="${item.id}" data-type="${item._type}" data-amount="${item.amount}" data-comment="${escapeHtml(item.comment || "")}" data-date="${item.date || ""}" data-empid="${item.employee_id || ""}" title="Редактировать">${editSvg}</button>
          <button class="adv-del-btn hist-del-btn" data-id="${item.id}" data-type="${item._type}" title="Удалить">${delSvg}</button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll(".hist-edit-btn").forEach(btn => {
      btn.onclick = () => openHistEditModal(btn.dataset.id, btn.dataset.type, btn.dataset.amount, btn.dataset.comment, btn.dataset.date, btn.dataset.empid, empId);
    });

    tbody.querySelectorAll(".hist-del-btn").forEach(btn => {
      btn.onclick = () => {
        const isAdv = btn.dataset.type === "adv";
        const url   = isAdv ? `${API}/api/advances/${btn.dataset.id}` : `${API}/api/salary/payments/${btn.dataset.id}`;
        confirmDelete(async () => {
          await fetch(url, { method: "DELETE" });
          await loadAll();
          renderHistBody(empId);
        }, { title: isAdv ? "Удалить аванс?" : "Удалить выплату?", text: "Запись будет удалена безвозвратно.", okLabel: "Удалить" });
      };
    });
  }

  // ── Редактирование записи истории ────────────────────────────────────
  const histEditModal = document.getElementById("salHistEditModal");
  let _histEditId = null;
  let _histEditType = null;
  let _histEditEmpId = null;
  let _histEditDate = null;
  let _histEditItemEmpId = null;

  function openHistEditModal(id, type, amount, comment, date, itemEmpId, empId) {
    _histEditId   = id;
    _histEditType = type;
    _histEditEmpId = empId;
    _histEditDate = date || "";
    _histEditItemEmpId = itemEmpId || "";
    document.getElementById("salHistEditTitle").textContent = type === "adv" ? "Редактировать аванс" : "Редактировать выплату";
    document.getElementById("salHistEditAmount").value  = amount || "";
    document.getElementById("salHistEditComment").value = comment || "";
    if (histEditModal) histEditModal.style.display = "flex";
  }
  function closeHistEditModal() { if (histEditModal) histEditModal.style.display = "none"; }

  document.getElementById("salHistEditClose")?.addEventListener("click", closeHistEditModal);
  document.getElementById("salHistEditCancel")?.addEventListener("click", closeHistEditModal);
  histEditModal?.addEventListener("click", e => { if (e.target === histEditModal) closeHistEditModal(); });

  document.getElementById("salHistEditSave")?.addEventListener("click", async () => {
    const amount  = parseFloat(document.getElementById("salHistEditAmount").value);
    const comment = document.getElementById("salHistEditComment").value.trim();
    if (!amount || amount <= 0) { alert("Введите корректную сумму"); return; }
    const url = _histEditType === "adv"
      ? `${API}/api/advances/${_histEditId}`
      : `${API}/api/salary/payments/${_histEditId}`;
    const body = _histEditType === "adv"
      ? { employee_id: Number(_histEditItemEmpId), amount, date: _histEditDate, comment }
      : { amount, comment };
    await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await loadAll();
    renderHistBody(_histEditEmpId);
    closeHistEditModal();
  });

  // ── Навигация ────────────────────────────────────────────────────────
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.section === "salary") loadAll();
    });
  });

  // ── SSE: обновлять зарплату если раздел открыт ───────────────────────
  function _salReloadIfActive() {
    if (document.getElementById("salary")?.classList.contains("active")) loadAll();
  }
  document.addEventListener("advances:reload", _salReloadIfActive);
  document.addEventListener("sseEmployees",    _salReloadIfActive);
})();

/* ===================================================================== */

const empFilter = document.getElementById("empFilter");
if (empFilter) {
  empFilter.onchange = async () => {
    const selectedDate = window.selectedCalendarDate || getLocalISODate();


    if (selectedDate) {
      await loadEmployeesForDate(selectedDate);
    } else {
      await loadEmployees();
    }
  };
}







/* =====================================================================
   РАЗДЕЛ «АДМИНИСТРАТОР»
   ===================================================================== */
(function initAdminSection() {

  const LS_KEY = "admCredentials";

  // Уникальный ID сессии (хранится только в памяти вкладки)
  const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  let pwdVisible    = false;
  let currentLogin    = "";
  let currentPassword = "";

  // --- LocalStorage ---
  function saveToLS() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ login: currentLogin, password: currentPassword })); } catch (e) {}
  }
  function loadFromLS() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (d.login)    currentLogin    = d.login;
      if (d.password) currentPassword = d.password;
    } catch (e) {}
  }

  // --- Рендер ---
  function renderAdminInfo() {
    const loginEl = document.getElementById("adminLoginDisplay");
    const pwdEl   = document.getElementById("adminPasswordDisplay");
    if (loginEl) loginEl.textContent = currentLogin || "—";
    if (pwdEl)   pwdEl.textContent   = pwdVisible
      ? (currentPassword || "—")
      : "•".repeat(Math.max(currentPassword.length, 6));
  }

  // --- Загрузить из БД ---
  async function loadAdminInfo() {
    try {
      const res  = await fetch(API + "/api/admin/info");
      if (!res.ok) return;
      const data = await res.json();
      currentLogin    = data.login    || "";
      currentPassword = data.password || "";
      saveToLS();
      renderAdminInfo();
    } catch (e) { console.error("loadAdminInfo:", e); }
  }

  // Сразу показать из localStorage, затем актуализировать из БД
  loadFromLS();
  renderAdminInfo();
  loadAdminInfo();

  // --- Показать/скрыть пароль ---
  const pwdToggleBtn = document.getElementById("adminPwdToggle");
  if (pwdToggleBtn) {
    pwdToggleBtn.onclick = () => {
      pwdVisible = !pwdVisible;
      pwdToggleBtn.querySelector(".eye-show").style.display = pwdVisible ? "none" : "";
      pwdToggleBtn.querySelector(".eye-hide").style.display = pwdVisible ? ""     : "none";
      renderAdminInfo();
    };
  }

  // --- Онлайн-счётчик ---
  function pluralUsers(n) {
    const mod10  = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${n} пользователей онлайн`;
    if (mod10 === 1)                  return `${n} пользователь онлайн`;
    if (mod10 >= 2 && mod10 <= 4)     return `${n} пользователя онлайн`;
    return `${n} пользователей онлайн`;
  }

  async function updateOnlineCount() {
    try {
      const res  = await fetch(API + "/api/admin/online");
      const data = await res.json();
      const countEl = document.getElementById("adminOnlineCount");
      const labelEl = document.getElementById("adminOnlineLabel");
      const n = data.count ?? 0;
      if (countEl) countEl.textContent = n;
      if (labelEl) labelEl.textContent = pluralUsers(n).replace(/^\d+\s*/, "");
    } catch (e) {}
  }

  // Heartbeat каждые 30 сек
  async function sendHeartbeat() {
    try {
      await fetch(API + "/api/admin/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
    } catch (e) {}
  }

  sendHeartbeat();
  setInterval(sendHeartbeat, 30 * 1000);

  // --- Открытие/закрытие модалок ---
  function openEditModal(overlayId, inputId, errorId, currentVal) {
    const overlay = document.getElementById(overlayId);
    const input   = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (!overlay || !input) return;
    input.value = currentVal || "";
    if (errorEl) errorEl.textContent = "";
    overlay.style.display = "flex";
    setTimeout(() => input.focus(), 50);
  }

  function closeEditModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) overlay.style.display = "none";
  }

  ["changeLoginModal", "changePasswordModal"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", e => { if (e.target === el) closeEditModal(id); });
  });

  // --- Изменить логин ---
  document.getElementById("changeLoginBtn")?.addEventListener("click", () =>
    openEditModal("changeLoginModal", "newLoginInput", "changeLoginError", currentLogin));
  document.getElementById("changeLoginCancel")?.addEventListener("click", () => closeEditModal("changeLoginModal"));
  document.getElementById("changeLoginSave")?.addEventListener("click", async () => {
    const input   = document.getElementById("newLoginInput");
    const errorEl = document.getElementById("changeLoginError");
    const val     = (input?.value || "").trim();
    if (!val) { if (errorEl) errorEl.textContent = "Логин не может быть пустым"; return; }
    try {
      const res = await fetch(API + "/api/admin/login", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: val })
      });
      if (!res.ok) { const d = await res.json(); if (errorEl) errorEl.textContent = d.error || "Ошибка"; return; }
      currentLogin = val;
      saveToLS();
      renderAdminInfo();
      closeEditModal("changeLoginModal");
    } catch (e) { if (errorEl) errorEl.textContent = "Ошибка сети"; }
  });

  // --- Изменить пароль ---
  document.getElementById("changePasswordBtn")?.addEventListener("click", () =>
    openEditModal("changePasswordModal", "newPasswordInput", "changePasswordError", currentPassword));
  document.getElementById("changePasswordCancel")?.addEventListener("click", () => closeEditModal("changePasswordModal"));
  document.getElementById("changePasswordSave")?.addEventListener("click", async () => {
    const input   = document.getElementById("newPasswordInput");
    const errorEl = document.getElementById("changePasswordError");
    const val     = (input?.value || "").trim();
    if (!val) { if (errorEl) errorEl.textContent = "Пароль не может быть пустым"; return; }
    try {
      const res = await fetch(API + "/api/admin/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: val })
      });
      if (!res.ok) { const d = await res.json(); if (errorEl) errorEl.textContent = d.error || "Ошибка"; return; }
      currentPassword = val;
      saveToLS();
      renderAdminInfo();
      closeEditModal("changePasswordModal");
    } catch (e) { if (errorEl) errorEl.textContent = "Ошибка сети"; }
  });

  // --- При переходе в раздел ---
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.section !== "admin") return;
      loadAdminInfo();
      updateOnlineCount();
    });
  });

  // Обновлять счётчик каждые 15 сек, пока раздел активен
  setInterval(() => {
    if (document.getElementById("admin")?.classList.contains("active")) {
      updateOnlineCount();
    }
  }, 15 * 1000);

  // Первоначальный счётчик
  updateOnlineCount();

})();

async function updateLiveWorkTime() {
  const selectedDate = window.selectedCalendarDate;
  const todayISO = getLocalISODate();

  if (selectedDate && selectedDate !== todayISO) {
    return;
  }

  if (selectedDate) {
    await loadEmployeesForDate(selectedDate);
  } else {
    await loadEmployees();
  }
}

const empSearch = document.getElementById("empSearch");
if (empSearch) {
  empSearch.oninput = debounce(async () => {
    const selectedDate = window.selectedCalendarDate || getLocalISODate();
    if (selectedDate) {
      await loadEmployeesForDate(selectedDate);
    } else {
      await loadEmployees();
    }
  }, 220);
}







document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("addTaskBtn");
  if (!btn) return;

  btn.onclick = async () => {
    const daySelect = document.getElementById("taskDay");
    const monthLabel = document.getElementById("taskMonthLabel");

    daySelect.innerHTML = "";

    const now = new Date();
    monthLabel.textContent = now.toLocaleString("ru-RU", {
      month: "long",
      year: "numeric"
    });

    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();

    const today = now.getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === today) opt.selected = true;
      daySelect.appendChild(opt);
    }

    document.getElementById("taskDesc").value  = "";
    document.getElementById("taskTitle").value = "";
    const _tf = document.getElementById("taskTimeFrom");
    const _dt = document.getElementById("taskDueTime");
    if (_tf) _tf.value = "";
    if (_dt) _dt.value = "";

    // Сбрасываем поиск и перезагружаем список сотрудников свежими данными
    const empSearch = document.getElementById("taskEmpSearch");
    if (empSearch) empSearch.value = "";

    // Очищаем все inline-ошибки
    ["taskTitle","taskDesc"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("field-error");
    });
    ["taskTitleError","taskDescError","taskEmpError"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ""; el.classList.remove("visible"); }
    });
    const empGrid = document.getElementById("employeeCheckboxes");
    if (empGrid) empGrid.classList.remove("field-error");

    // Открываем на шаге 1 и показываем модалку
    wizardGoTo(1);
    document.getElementById("addTaskModal").style.display = "flex";

    // Загружаем список сотрудников (всегда свежий)
    await populateEmployeeCheckboxes();
  };
});


/* ─── Wizard для модалки редактирования ─────────────────────────── */
let _editWizardStep = 1;
const EDIT_WIZARD_STEPS = 4;

function editWizardGoTo(step) {
  _editWizardStep = step;

  document.querySelectorAll("#editTaskModal .wizard-panel").forEach(p => {
    p.classList.toggle("active", Number(p.dataset.panel) === step);
  });
  document.querySelectorAll("#editTaskWizardSteps .wz-step").forEach(s => {
    const n = Number(s.dataset.step);
    s.classList.toggle("active", n === step);
    s.classList.toggle("done",   n < step);
  });

  const backBtn = document.getElementById("editWizardBackBtn");
  const nextBtn = document.getElementById("editWizardNextBtn");
  const saveBtn = document.getElementById("saveEditTask");
  if (backBtn) backBtn.classList.toggle("wz-hidden", step === 1);
  if (nextBtn) nextBtn.classList.toggle("wz-hidden", step === EDIT_WIZARD_STEPS);
  if (saveBtn) saveBtn.classList.toggle("wz-hidden", step !== EDIT_WIZARD_STEPS);

  const body = document.querySelector("#editTaskModal .task-modal-body");
  if (body) body.scrollTop = 0;
}

/* ─── Открыть модал редактирования (централизованно) ─────────────── */
async function openEditModal(taskId) {
  const [tasks, employees] = await Promise.all([fetchTasks(), fetchEmployees()]);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  /* ── Panel 1: дата / время / заголовок / описание ── */
  const daySelect   = document.getElementById("editTaskDay");
  const monthLabel  = document.getElementById("editTaskMonthLabel");
  const titleInput  = document.getElementById("editTaskTitle");
  const descInput   = document.getElementById("editTaskDesc");
  const timeFromInp = document.getElementById("editTaskTimeFrom");
  const dueTimeInp  = document.getElementById("editTaskDueTime");

  daySelect.innerHTML = "";
  const now = new Date();
  monthLabel.textContent = now.toLocaleString("ru-RU", { month: "long", year: "numeric" });
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    daySelect.appendChild(opt);
  }
  daySelect.value  = parseInt((task.date || "").split("-")[2] || 1, 10);
  titleInput.value = task.title || "";
  descInput.value  = task.description || "";
  if (timeFromInp) timeFromInp.value = task.time_from || "";
  if (dueTimeInp)  dueTimeInp.value  = task.due_time  || "";

  const titleErr = document.getElementById("editTaskTitleError");
  if (titleErr) { titleErr.textContent = ""; titleErr.classList.remove("visible"); }
  titleInput.classList.remove("field-error");

  /* ── Panel 2: сотрудники ── */
  const empGrid = document.getElementById("editEmployeeCheckboxes");
  empGrid.innerHTML = "";
  employees.forEach(emp => {
    const isAssigned = task.assignedEmployees?.includes(emp.id) || false;
    const wrap = document.createElement("label");
    wrap.className = "checkbox-item";
    wrap.innerHTML = `<input type="checkbox" class="emp-check" data-id="${emp.id}" ${isAssigned ? "checked" : ""}><span>${escapeHtml(emp.name)}</span>`;
    empGrid.appendChild(wrap);
  });
  const empErr = document.getElementById("editTaskEmpError");
  if (empErr) { empErr.textContent = ""; empErr.classList.remove("visible"); }
  empGrid.classList.remove("field-error");

  const editEmpSearch = document.getElementById("editTaskEmpSearch");
  if (editEmpSearch) {
    editEmpSearch.value = "";
    editEmpSearch.oninput = () => {
      const q = editEmpSearch.value.trim().toLowerCase();
      let vis = 0;
      document.querySelectorAll("#editEmployeeCheckboxes .checkbox-item").forEach(item => {
        const name = item.querySelector("span")?.textContent?.toLowerCase() || "";
        const show = !q || name.includes(q);
        item.classList.toggle("hidden", !show);
        if (show) vis++;
      });
      let emptyMsg = document.getElementById("editTaskEmpEmpty");
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.id = "editTaskEmpEmpty";
        emptyMsg.className = "task-emp-empty";
        emptyMsg.textContent = "Сотрудники не найдены";
        empGrid.appendChild(emptyMsg);
      }
      emptyMsg.style.display = vis === 0 ? "block" : "none";
    };
  }

  /* ── Panel 3: главный сотрудник (строим из выбранных) ── */
  function rebuildMainList(keepMainId) {
    const mainList = document.getElementById("editWizardMainEmpList");
    const mainErr  = document.getElementById("editWizardMainEmpError");
    if (!mainList) return;
    mainList.innerHTML = "";
    mainList.classList.remove("field-error");
    if (mainErr) { mainErr.textContent = ""; mainErr.classList.remove("visible"); }

    const checked = Array.from(empGrid.querySelectorAll("input[type='checkbox']:checked"));
    checked.forEach(cb => {
      const empId   = cb.dataset.id;
      const empName = cb.closest(".checkbox-item")?.querySelector("span")?.textContent?.trim() || String(empId);
      const item = document.createElement("label");
      item.className = "select-main-item";
      const isMain = Number(empId) === Number(keepMainId);
      item.innerHTML = `<input type="radio" name="editMainChoice" value="${empId}" ${isMain ? "checked" : ""}><span class="select-main-name">${escapeHtml(empName)}</span>`;
      item.querySelector("input").addEventListener("change", () => {
        mainList.classList.remove("field-error");
        if (mainErr) { mainErr.textContent = ""; mainErr.classList.remove("visible"); }
      });
      mainList.appendChild(item);
    });
    if (checked.length === 1) {
      const radio = mainList.querySelector("input[type='radio']");
      if (radio) radio.checked = true;
    }
  }

  /* ── Panel 4: фото ── */
  _editTaskNewPhotos = [];
  _editTaskDeleteIds = [];
  fetchAndRenderEditTaskPhotos(taskId);

  /* ── Time picker ── */
  const editTP = initTimePicker(
    "editTaskTimeFrom", "editTaskDueTime",
    "editTaskNoTimeBtn", "editTaskTimeFields",
    "editTaskDuration", "editTaskTimeError"
  );
  const hasTime = !!(task.time_from || task.due_time);
  if (editTP.setNoTime) editTP.setNoTime(!hasTime);

  /* ── Показать модалку ── */
  document.getElementById("tasksModal").style.display = "none";
  editWizardGoTo(1);
  document.getElementById("editTaskModal").style.display = "flex";

  /* ── Закрытие ── */
  const doClose = () => {
    _editTaskNewPhotos = [];
    _editTaskDeleteIds = [];
    renderEditTaskPreviews(taskId, []);
    if (editEmpSearch) editEmpSearch.value = "";
    editWizardGoTo(1);
    document.getElementById("editTaskModal").style.display = "none";
  };
  document.getElementById("cancelEditTask").onclick  = doClose;
  document.getElementById("closeEditTaskBtn").onclick = doClose;

  /* ── «Назад» ── */
  document.getElementById("editWizardBackBtn").onclick = () => {
    if (_editWizardStep > 1) editWizardGoTo(_editWizardStep - 1);
  };

  /* ── «Далее» ── */
  document.getElementById("editWizardNextBtn").onclick = () => {
    if (_editWizardStep === 1) {
      const title = titleInput.value.trim();
      titleInput.classList.remove("field-error");
      if (titleErr) { titleErr.textContent = ""; titleErr.classList.remove("visible"); }
      let ok = true;
      if (!title) {
        titleInput.classList.add("field-error");
        if (titleErr) { titleErr.textContent = "Введите заголовок задания"; titleErr.classList.add("visible"); }
        ok = false;
      }
      if (ok && editTP.validate && !editTP.validate()) ok = false;
      if (ok) editWizardGoTo(2);

    } else if (_editWizardStep === 2) {
      const checked = empGrid.querySelectorAll("input[type='checkbox']:checked");
      empGrid.classList.remove("field-error");
      if (empErr) { empErr.textContent = ""; empErr.classList.remove("visible"); }
      if (checked.length === 0) {
        empGrid.classList.add("field-error");
        if (empErr) { empErr.textContent = "Выберите хотя бы одного сотрудника"; empErr.classList.add("visible"); }
        return;
      }
      const currentMain = document.querySelector("#editWizardMainEmpList input[type='radio']:checked");
      rebuildMainList(currentMain ? currentMain.value : task.main_employee_id);
      editWizardGoTo(3);

    } else if (_editWizardStep === 3) {
      const selected = document.querySelector("#editWizardMainEmpList input[type='radio']:checked");
      const mainList = document.getElementById("editWizardMainEmpList");
      const mainErr  = document.getElementById("editWizardMainEmpError");
      if (!selected) {
        if (mainList) mainList.classList.add("field-error");
        if (mainErr)  { mainErr.textContent = "Выберите ответственного сотрудника"; mainErr.classList.add("visible"); }
        return;
      }
      editWizardGoTo(4);
    }
  };

  /* ── «Сохранить» ── */
  document.getElementById("saveEditTask").onclick = async () => {
    if (editTP.validate && !editTP.validate()) { editWizardGoTo(1); return; }

    const newDate     = toISODateFromDay(daySelect.value);
    const newTitle    = titleInput.value.trim();
    const newDesc     = descInput.value.trim();
    const newTimeFrom = timeFromInp ? (timeFromInp.value || null) : null;
    const newDueTime  = dueTimeInp  ? (dueTimeInp.value  || null) : null;
    const checkedCbs  = empGrid.querySelectorAll(".emp-check:checked");
    const empIds      = Array.from(checkedCbs).map(i => Number(i.dataset.id));
    const mainRadio   = document.querySelector("#editWizardMainEmpList input[type='radio']:checked");
    const mainEmpId   = mainRadio ? Number(mainRadio.value) : (empIds[0] || null);

    const res = await fetch(API + "/api/tasks/" + taskId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: newDate, title: newTitle, description: newDesc,
        time_from: newTimeFrom, due_time: newDueTime,
        assignedEmployees: empIds,
        mainEmployeeId: mainEmpId,
        type: empIds.length ? "assigned" : "open"
      })
    });

    if (!res.ok) { console.error("Ошибка сохранения"); return; }

    // Удаляем помеченные фото
    await Promise.all(_editTaskDeleteIds.map(pid =>
      fetch(`${API}/api/tasks/photos/${pid}`, { method: "DELETE" })
    ));
    // Загружаем новые
    await Promise.all(_editTaskNewPhotos.map(async p => {
      const fd = new FormData(); fd.append("photo", p.file);
      const upR = await fetch(API + "/api/upload/task-photo", { method: "POST", body: fd });
      if (!upR.ok) return;
      const { url } = await upR.json();
      return fetch(`${API}/api/tasks/${taskId}/photos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_path: url })
      });
    }));

    doClose();
    await loadTasksTable();
    await loadEmployees();
  };
}

/* ── Time Picker helper ──────────────────────────────────────────── */
function initTimePicker(fromId, toId, noTimeBtnId, fieldsId, durationId, errorId) {
  const fromInp   = document.getElementById(fromId);
  const toInp     = document.getElementById(toId);
  const noTimeBtn = document.getElementById(noTimeBtnId);
  const fields    = document.getElementById(fieldsId);
  const durEl     = document.getElementById(durationId);
  const errEl     = document.getElementById(errorId);
  if (!fromInp || !toInp || !noTimeBtn || !fields) return {};

  function toMins(val) {
    if (!val) return null;
    const [h, m] = val.split(":").map(Number);
    return h * 60 + m;
  }
  function fmtDiff(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return `${h}ч ${m}м`;
    if (h)      return `${h}ч`;
    return `${m}м`;
  }
  function isNoTime() {
    return noTimeBtn.classList.contains("active");
  }

  function setErr(msg) {
    if (errEl) errEl.textContent = msg;
  }
  function clearErr() {
    if (errEl) errEl.textContent = "";
    if (durEl) durEl.textContent = "";
  }

  function update() {
    if (isNoTime()) { clearErr(); return; }
    const from = toMins(fromInp.value);
    const to   = toMins(toInp.value);
    if (from === null || to === null) {
      if (durEl) durEl.textContent = "";
      // Ошибку не ставим при вводе — только при сохранении
      if (errEl && errEl.textContent && errEl.textContent !== "Время окончания должно быть больше времени начала") {
        errEl.textContent = "";
      }
      return;
    }
    if (to <= from) {
      if (durEl) durEl.textContent = "";
      setErr("Время окончания должно быть больше времени начала");
      return;
    }
    clearErr();
    if (durEl) durEl.textContent = fmtDiff(to - from);
  }

  // Возвращает true если всё ок, false если есть ошибка (и показывает её)
  function validate() {
    if (isNoTime()) { clearErr(); return true; }
    const from = toMins(fromInp.value);
    const to   = toMins(toInp.value);
    if (from === null && to === null) {
      setErr("Укажите время начала и окончания");
      return false;
    }
    if (from === null || to === null) {
      setErr("Заполните оба поля времени");
      return false;
    }
    if (to <= from) {
      setErr("Время окончания должно быть больше времени начала");
      return false;
    }
    clearErr();
    return true;
  }

  noTimeBtn.onclick = () => {
    const active = noTimeBtn.classList.toggle("active");
    fields.classList.toggle("hidden", active);
    if (active) {
      fromInp.value = "";
      toInp.value   = "";
      clearErr();
    }
  };

  fromInp.oninput = update;
  toInp.oninput   = update;

  fields.querySelectorAll(".tp-preset").forEach(btn => {
    btn.onclick = () => {
      const hours = parseInt(btn.dataset.hours, 10);
      let from = toMins(fromInp.value);
      if (from === null) {
        const now = new Date();
        from = now.getHours() * 60 + now.getMinutes();
        fromInp.value = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      }
      const toVal = (from + hours * 60) % (24 * 60);
      toInp.value = `${String(Math.floor(toVal / 60)).padStart(2,"0")}:${String(toVal % 60).padStart(2,"0")}`;
      update();
    };
  });

  function setNoTime(val) {
    noTimeBtn.classList.toggle("active", val);
    fields.classList.toggle("hidden", val);
    if (!val) { update(); }
    else { clearErr(); }
  }

  return { update, validate, setNoTime };
}

// ── Wizard state ────────────────────────────────────────────────────────────
let _wizardStep = 1;
const WIZARD_STEPS = 4;

function wizardGoTo(step) {
  _wizardStep = step;

  // Update panels
  document.querySelectorAll("#addTaskModal .wizard-panel").forEach(p => {
    p.classList.toggle("active", Number(p.dataset.panel) === step);
  });

  // Update step indicators
  document.querySelectorAll("#addTaskWizardSteps .wz-step").forEach(s => {
    const n = Number(s.dataset.step);
    s.classList.toggle("active", n === step);
    s.classList.toggle("done",   n < step);
  });

  // Update footer buttons
  const backBtn = document.getElementById("wizardBackBtn");
  const nextBtn = document.getElementById("wizardNextBtn");
  const saveBtn = document.getElementById("saveTask");

  if (backBtn) backBtn.classList.toggle("wz-hidden", step === 1);
  if (nextBtn) nextBtn.classList.toggle("wz-hidden", step === WIZARD_STEPS);
  if (saveBtn) saveBtn.classList.toggle("wz-hidden", step !== WIZARD_STEPS);

  // Scroll body to top when switching panels
  const body = document.querySelector("#addTaskModal .task-modal-body");
  if (body) body.scrollTop = 0;
}

function restoreAddTaskModalHandlers() {
  // Инициализируем wizard в состояние шага 1
  wizardGoTo(1);

  // Инициализируем time picker для модалки добавления (один раз)
  const addTP = initTimePicker(
    "taskTimeFrom", "taskDueTime",
    "taskNoTimeBtn", "taskTimeFields",
    "taskDuration", "taskTimeError"
  );
  // По умолчанию — без времени
  if (addTP.setNoTime) addTP.setNoTime(true);

  function closeAddTaskModal() {
    document.getElementById("taskTitle").value = "";
    document.getElementById("taskDesc").value  = "";
    const tf = document.getElementById("taskTimeFrom");
    const dt = document.getElementById("taskDueTime");
    if (tf) tf.value = "";
    if (dt) dt.value = "";
    if (addTP.setNoTime) addTP.setNoTime(true);
    const empSearch = document.getElementById("taskEmpSearch");
    if (empSearch) empSearch.value = "";
    document.querySelectorAll("#employeeCheckboxes .checkbox-item").forEach(item => {
      item.classList.remove("hidden");
    });
    ["taskTitle","taskDesc"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("field-error");
    });
    ["taskTitleError","taskDescError","taskEmpError"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ""; el.classList.remove("visible"); }
    });
    const empGrid = document.getElementById("employeeCheckboxes");
    if (empGrid) empGrid.classList.remove("field-error");
    // Сбрасываем шаг 3 (главный сотрудник)
    const mainList = document.getElementById("wizardMainEmpList");
    if (mainList) mainList.innerHTML = "";
    const mainErr = document.getElementById("wizardMainEmpError");
    if (mainErr) { mainErr.textContent = ""; mainErr.classList.remove("visible"); }
    // Очищаем фото
    _addTaskPhotos = [];
    renderAddTaskPreviews();
    // Сброс на шаг 1
    wizardGoTo(1);
    document.getElementById("addTaskModal").style.display = "none";
  }

  const cancelBtn = document.getElementById("cancelTask");
  if (cancelBtn) cancelBtn.onclick = closeAddTaskModal;

  const closeBtn = document.getElementById("addTaskCloseBtn");
  if (closeBtn) closeBtn.onclick = closeAddTaskModal;

  // Поиск по сотрудникам (шаг 2)
  const empSearch = document.getElementById("taskEmpSearch");
  if (empSearch) {
    empSearch.oninput = () => {
      const q = empSearch.value.trim().toLowerCase();
      const items = document.querySelectorAll("#employeeCheckboxes .checkbox-item");
      let visibleCount = 0;
      items.forEach(item => {
        const name = item.querySelector("span")?.textContent?.toLowerCase() || "";
        const visible = !q || name.includes(q);
        item.classList.toggle("hidden", !visible);
        if (visible) visibleCount++;
      });
      let emptyMsg = document.getElementById("taskEmpEmpty");
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.id = "taskEmpEmpty";
        emptyMsg.className = "task-emp-empty";
        emptyMsg.textContent = "Сотрудники не найдены";
        document.getElementById("employeeCheckboxes").appendChild(emptyMsg);
      }
      emptyMsg.style.display = visibleCount === 0 ? "block" : "none";
    };
  }

  // Inline-error helpers
  function setErr(fieldId, errId, msg) {
    const field = document.getElementById(fieldId);
    const err   = document.getElementById(errId);
    if (field) field.classList.add("field-error");
    if (err)   { err.textContent = msg; err.classList.add("visible"); }
  }
  function clearErr(fieldId, errId) {
    const field = document.getElementById(fieldId);
    const err   = document.getElementById(errId);
    if (field) field.classList.remove("field-error");
    if (err)   { err.textContent = ""; err.classList.remove("visible"); }
  }

  // Clear on input
  const titleInput = document.getElementById("taskTitle");
  if (titleInput) titleInput.addEventListener("input", () => clearErr("taskTitle", "taskTitleError"));
  const descInput = document.getElementById("taskDesc");
  if (descInput) descInput.addEventListener("input", () => clearErr("taskDesc", "taskDescError"));
  // Event delegation — работает с динамически добавленными чекбоксами
  document.getElementById("employeeCheckboxes")?.addEventListener("change", e => {
    if (!e.target.matches("input[type='checkbox']")) return;
    const empGrid = document.getElementById("employeeCheckboxes");
    if (empGrid) empGrid.classList.remove("field-error");
    const empErr = document.getElementById("taskEmpError");
    if (empErr) { empErr.textContent = ""; empErr.classList.remove("visible"); }
  });

  // ── «Далее» — переход между шагами с валидацией ─────────────────────────
  const nextBtn = document.getElementById("wizardNextBtn");
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (_wizardStep === 1) {
        // Валидация шага 1: заголовок обязателен; время валидируем через addTP
        let ok = true;
        clearErr("taskTitle", "taskTitleError");

        const title = document.getElementById("taskTitle").value.trim();
        if (!title) {
          setErr("taskTitle", "taskTitleError", "Введите заголовок задания");
          ok = false;
        }
        if (ok && addTP.validate && !addTP.validate()) ok = false;

        if (ok) wizardGoTo(2);

      } else if (_wizardStep === 2) {
        // Валидация шага 2: хотя бы один сотрудник
        const empGrid = document.getElementById("employeeCheckboxes");
        const empErr  = document.getElementById("taskEmpError");
        const checked = document.querySelectorAll("#employeeCheckboxes input[type='checkbox']:checked");

        if (empGrid) empGrid.classList.remove("field-error");
        if (empErr)  { empErr.textContent = ""; empErr.classList.remove("visible"); }

        if (checked.length === 0) {
          if (empGrid) empGrid.classList.add("field-error");
          if (empErr)  { empErr.textContent = "Выберите хотя бы одного сотрудника"; empErr.classList.add("visible"); }
          return;
        }

        // Строим список радио для шага 3
        const mainList = document.getElementById("wizardMainEmpList");
        const mainErr  = document.getElementById("wizardMainEmpError");
        if (mainList) {
          mainList.innerHTML = "";
          mainList.classList.remove("field-error");
        }
        if (mainErr) { mainErr.textContent = ""; mainErr.classList.remove("visible"); }

        Array.from(checked).forEach(cb => {
          const empId   = cb.dataset.id;
          const empName = cb.closest(".checkbox-item")?.querySelector("span")?.textContent?.trim() || String(empId);
          const item = document.createElement("label");
          item.className = "select-main-item";
          item.innerHTML =
            `<input type="radio" name="wizardMainChoice" value="${empId}">` +
            `<span class="select-main-name">${escapeHtml(empName)}</span>`;
          item.querySelector("input").addEventListener("change", () => {
            if (mainList) mainList.classList.remove("field-error");
            if (mainErr)  { mainErr.textContent = ""; mainErr.classList.remove("visible"); }
          });
          mainList.appendChild(item);
        });

        // Авто-выбор если сотрудник один
        if (checked.length === 1) {
          const radio = mainList.querySelector("input[type='radio']");
          if (radio) radio.checked = true;
        }

        wizardGoTo(3);

      } else if (_wizardStep === 3) {
        // Валидация шага 3: должен быть выбран главный сотрудник
        const mainList = document.getElementById("wizardMainEmpList");
        const mainErr  = document.getElementById("wizardMainEmpError");
        const selected = document.querySelector("#wizardMainEmpList input[type='radio']:checked");

        if (!selected) {
          if (mainList) mainList.classList.add("field-error");
          if (mainErr)  { mainErr.textContent = "Выберите ответственного сотрудника"; mainErr.classList.add("visible"); }
          return;
        }

        wizardGoTo(4);
      }
    };
  }

  // ── «Назад» ──────────────────────────────────────────────────────────────
  const backBtn = document.getElementById("wizardBackBtn");
  if (backBtn) {
    backBtn.onclick = () => {
      if (_wizardStep > 1) wizardGoTo(_wizardStep - 1);
    };
  }

  // ── «Сохранить» ──────────────────────────────────────────────────────────
  const saveBtn = document.getElementById("saveTask");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const title    = document.getElementById("taskTitle").value.trim();
      const desc     = document.getElementById("taskDesc").value.trim();
      const day      = document.getElementById("taskDay").value;
      const date     = toISODateFromDay(day);
      const timeFrom = document.getElementById("taskTimeFrom")?.value || null;
      const dueTime  = document.getElementById("taskDueTime")?.value  || null;
      const checked  = document.querySelectorAll("#employeeCheckboxes input[type='checkbox']:checked");
      const assigned = Array.from(checked).map(i => Number(i.dataset.id));

      const mainRadio      = document.querySelector("#wizardMainEmpList input[type='radio']:checked");
      const mainEmployeeId = mainRadio ? Number(mainRadio.value) : null;

      // Финальная проверка дублей
      const allTasks = await fetchTasks();
      const duplicate = allTasks.find(
        t => t.date === date && t.title.trim().toLowerCase() === title.toLowerCase()
      );
      if (duplicate) {
        wizardGoTo(1);
        setErr("taskTitle", "taskTitleError", "Задание с таким заголовком уже существует на эту дату");
        return;
      }

      const res = await fetch(API + "/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          title,
          description: desc,
          type: "assigned",
          assignedEmployees: assigned,
          time_from: timeFrom || null,
          due_time:  dueTime  || null,
          mainEmployeeId
        })
      });

      if (!res.ok) {
        alert("Ошибка при сохранении задания");
        return;
      }

      const created = await res.json();
      const taskId  = created.id;

      if (taskId && _addTaskPhotos.length) {
        await Promise.all(_addTaskPhotos.map(async p => {
          const fd = new FormData(); fd.append("photo", p.file);
          const upR = await fetch(API + "/api/upload/task-photo", { method: "POST", body: fd });
          if (!upR.ok) return;
          const { url } = await upR.json();
          return fetch(`${API}/api/tasks/${taskId}/photos`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photo_path: url })
          });
        }));
        _addTaskPhotos = [];
        renderAddTaskPreviews();
      }

      document.getElementById("addTaskModal").style.display = "none";
      wizardGoTo(1);
      await refreshTaskDateSelector(true);
      await loadTasksTable();
      await loadEmployees();
    };
  }
}





async function openSelectMainEmployeeModal(selectedEmployeeIds, onConfirm) {
  const modal = document.getElementById("selectMainModal");
  const list = document.getElementById("mainEmployeeList");
  const btnOk = document.getElementById("confirmMainSelect");
  const btnCancel = document.getElementById("cancelMainSelect");

  list.innerHTML = "";

  const employees = await fetchEmployees();
  const chosen = employees.filter(e => selectedEmployeeIds.includes(e.id));
  const errEl = document.getElementById("selectMainError");
  if (errEl) { errEl.textContent = ""; errEl.classList.remove("visible"); }

  chosen.forEach(emp => {
    const item = document.createElement("label");
    item.className = "select-main-item";
    item.innerHTML = `
      <input type="radio" name="mainChoice" value="${emp.id}">
      <span class="select-main-name">${escapeHtml(emp.name)}</span>
    `;
    // Скрываем ошибку при выборе
    item.querySelector("input").addEventListener("change", () => {
      list.classList.remove("field-error");
      if (errEl) { errEl.textContent = ""; errEl.classList.remove("visible"); }
    });
    list.appendChild(item);
  });

  modal.style.display = "flex";

  btnCancel.onclick = () => {
    modal.style.display = "none";
  };

  btnOk.onclick = () => {
    const selected = document.querySelector("input[name='mainChoice']:checked");
    if (!selected) {
      list.classList.add("field-error");
      if (errEl) { errEl.textContent = "Выберите ответственного сотрудника"; errEl.classList.add("visible"); }
      return;
    }

    const mainEmployeeId = Number(selected.value);
    modal.style.display = "none";
    onConfirm(mainEmployeeId);
  };
}







// Перенаправляем на централизованную функцию
async function openTaskEditModal(taskId) {
  openEditModal(taskId);
}




/* =====================================================================
   SSE — мгновенное обновление данных без опроса
   ===================================================================== */
async function refreshEmployees() {
  invalidateEmployeeCache();
  const date = window.selectedCalendarDate || getLocalISODate();
  await loadEmployeesForDate(date);
}

async function refreshTasks() {
  await refreshTaskDateSelector(false);
  if (document.getElementById("tasks")?.classList.contains("active")) {
    await loadTasksTable();
  }
}

function connectSSE() {
  const es = new EventSource(API + "/api/events");

  es.addEventListener("employees", () => {
    invalidateEmployeeCache();
    refreshEmployees();
    document.dispatchEvent(new CustomEvent("sseEmployees"));
  });
  es.addEventListener("tasks", () => {
    invalidateEmployeeCache();
    refreshTasks();
    refreshEmployees();
    document.dispatchEvent(new CustomEvent("sseTasks"));
  });
  es.addEventListener("advances", () => {
    document.dispatchEvent(new CustomEvent("advances:reload"));
  });
  es.addEventListener("notifications", () => {
    document.dispatchEvent(new CustomEvent("sseNotifications"));
  });

  es.onerror = () => {
    // EventSource reconnects automatically; log silently
    console.warn("SSE: соединение прервано, автопереподключение...");
  };

  return es;
}

// Начальная загрузка данных
(async () => {
  const date = window.selectedCalendarDate || getLocalISODate();
  await loadEmployeesForDate(date);
  await refreshTaskDateSelector(false);
})();

// Подключаем SSE — заменяет setInterval(globalAutoUpdate, 15000)
connectSSE();


















async function loadEmployeesForDate(date) {
  const [employees, shifts, tasks] = await Promise.all([fetchEmployees(), fetchShifts(), fetchTasks()]);

  const searchValue = document.getElementById("empSearch")?.value?.toLowerCase().trim() || "";
  const cards = document.getElementById("employeeCards");
  if (!cards) return;

  // Build O(n+m) lookup: empId → tasks on this date (instead of O(n·m) .filter() per employee)
  const tasksByEmpId = new Map();
  for (const t of tasks) {
    if (t.date !== date) continue;
    const ids = new Set([...(t.assignedEmployees || []), ...(t.participants || [])]);
    for (const eid of ids) {
      if (!tasksByEmpId.has(eid)) tasksByEmpId.set(eid, []);
      tasksByEmpId.get(eid).push(t);
    }
  }

  // Build shift lookup: empId → sorted shifts (instead of .filter() per employee)
  const shiftsByEmpId = new Map();
  for (const s of shifts) {
    if (!shiftsByEmpId.has(s.employee_id)) shiftsByEmpId.set(s.employee_id, []);
    shiftsByEmpId.get(s.employee_id).push(s);
  }

  cards.innerHTML = "";

  const filteredEmployees = searchValue
    ? employees.filter(e =>
        e.name.toLowerCase().includes(searchValue) ||
        e.password.toLowerCase().includes(searchValue)
      )
    : employees;

  const todayISO = getLocalISODate();
  const isToday = date === todayISO;
  const isFuture = date > todayISO;
  const isPast = date < todayISO;

  const empFilter = document.getElementById("empFilter");
  if (empFilter) {
    empFilter.disabled = isFuture;
    empFilter.style.opacity = isFuture ? "0.5" : "1";
    empFilter.style.cursor = isFuture ? "not-allowed" : "pointer";
  }

  const toggle = document.getElementById("calendarToggle");
  if (toggle) {
    const currentText = toggle.textContent.replace(" (сегодня)", "");
    toggle.textContent = isToday ? currentText + " (сегодня)" : currentText;
  }

  const filterValue = document.getElementById("empFilter")?.value || "all";

  for (const emp of filteredEmployees) {
    let startTime = "—";
    let endTime = "—";
    let statusText = "—";
    let actionButtons = "";
    let isActive = false;

    const allEmpShifts = shiftsByEmpId.get(emp.id) || [];
    const empShifts = allEmpShifts.filter(s => {
      if (!s.start_time) return false;
      const startDay = s.start_time.slice(0, 10);
      const endDay   = s.end_time ? s.end_time.slice(0, 10) : null;
      if (!endDay && s.status === "open") return startDay <= date;
      if (endDay) return date >= startDay && date <= endDay;
      return false;
    }).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const lastShift = empShifts[empShifts.length - 1];

    if (lastShift) {
      if (lastShift.status === "open") isActive = true;
      if (lastShift.start_time) startTime = lastShift.start_time.slice(11, 16);
      endTime = lastShift.end_time ? lastShift.end_time.slice(11, 16) : "—";
    }

    if (isFuture) {
      startTime = "—";
      endTime = "—";
      isActive = false;
    }

    if (filterValue === "on") {
      if (isToday && !isActive) continue;
      if (isPast && empShifts.length === 0) continue;
      if (isFuture) continue;
    }

    if (filterValue === "off") {
      if (isToday && isActive) continue;
      if (isPast && empShifts.length > 0) continue;
    }

    if (isFuture) {
      statusText = "Вне смены";
      actionButtons = `
        <button class="btn startStopBtn" disabled>Начать</button>
        <button class="btn showTasksBtn" data-id="${emp.id}" data-date="${date}">Задания</button>`;
    } else if (isPast) {
      statusText = empShifts.length > 0 ? "Был на смене" : "Вне смены";
      actionButtons = `
        <button class="btn startStopBtn" disabled>Завершить</button>
        <button class="btn showTasksBtn" data-id="${emp.id}" data-date="${date}">Задания</button>`;
    } else {
      statusText = isActive ? "На смене" : "Вне смены";
      actionButtons = `
        <button class="btn startStopBtn" data-id="${emp.id}" data-active="${isActive}" data-startiso="${isActive && lastShift ? (lastShift.start_time || '') : ''}">
          ${isActive ? "Завершить" : "Начать"}
        </button>
        <button class="btn showTasksBtn" data-id="${emp.id}" data-date="${date}">Задания</button>`;
    }

    const empTasks = isFuture ? [] : (tasksByEmpId.get(emp.id) || []);
    const activeTasks = isFuture ? "—" : empTasks.filter(t => t.status !== "done").length;
    const doneTasks   = isFuture ? "—" : empTasks.filter(t => t.status === "done").length;

    const avatarUrl = emp.avatar
      ? (emp.avatar.startsWith("/uploads/") ? (API + emp.avatar) : emp.avatar)
      : defaultAvatarSvg;

    // Сохраняем данные для модалки профиля
    _empProfileData.set(emp.id, {
      name: emp.name,
      avatarUrl,
      password: emp.password || "",
      activeTasks: typeof activeTasks === "number" ? activeTasks : 0,
      doneTasks:   typeof doneTasks   === "number" ? doneTasks   : 0,
      statusText,
      startTime,
      endTime,
      isActive,
      date,
      canToggleShift: !isFuture && !isPast,
      ratingHtml: empRatingHtml(tasks, emp.id, date.slice(0, 7)),
      shiftStartISO: (isActive && lastShift) ? lastShift.start_time : null,
    });

    const card = document.createElement("article");
    card.className = "employee-card";
    card.dataset.empId = emp.id;
    card.innerHTML = `
      <div class="employee-card-head">
        <div class="employee-card-person">
          <img class="employee-card-avatar" src="${avatarUrl}" alt="${escapeHtml(emp.name)}">
          <h4 class="employee-card-name">${escapeHtml(emp.name)}</h4>
        </div>
        <span class="employee-card-status ${statusText === "\u041d\u0430 \u0441\u043c\u0435\u043d\u0435" ? "on" : "off"}">
          ${statusText}
        </span>
      </div>

      <div class="employee-card-secondary">
        <span>\u0412 \u0440\u0430\u0431\u043e\u0442\u0435: <strong>${activeTasks}</strong></span>
        <span>\u0412\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e: <strong>${doneTasks}</strong></span>
      </div>

      <div class="employee-card-primary">
        <span>\u041d\u0430\u0447\u0430\u043b\u043e: <strong>${startTime}</strong></span>
        <span>\u041a\u043e\u043d\u0435\u0446: <strong>${endTime}</strong></span>
      </div>

      ${empRatingHtml(tasks, emp.id, date.slice(0, 7))}

      <div class="employee-card-actions">${actionButtons}</div>
    `;

    cards.appendChild(card);
  }

  if (!cards.children.length) {
    cards.innerHTML = `<div class="employee-cards-empty">Сотрудники не найдены</div>`;
  }

  // Event delegation — один обработчик на весь контейнер вместо N обработчиков на N кнопках
  cards._delegateDate = date;
  if (!cards._delegateAttached) {
    cards._delegateAttached = true;
    cards.addEventListener("click", async e => {
      // Кнопки — приоритет, карточка не срабатывает
      const ssBtn = e.target.closest(".startStopBtn");
      if (ssBtn && !ssBtn.disabled) {
        ssBtn.disabled = true;
        try {
          await toggleShift(Number(ssBtn.dataset.id), ssBtn.dataset.active === "true", ssBtn.dataset.startiso || null);
        } finally { ssBtn.disabled = false; }
        return;
      }
      const stBtn = e.target.closest(".showTasksBtn");
      if (stBtn) { openTasksModalForEmployee(Number(stBtn.dataset.id), stBtn.dataset.date); return; }

      // Клик по карточке — открыть профиль
      const card = e.target.closest(".employee-card[data-emp-id]");
      if (card) {
        const empId = Number(card.dataset.empId);
        const data = _empProfileData.get(empId);
        if (data) openEmpProfileModal(empId, data);
      }
    });
  }
}

/* ─── Модалка профиля сотрудника (просмотр) ─────────────────────── */
(function initEmpProfileModal() {
  const overlay        = document.getElementById("empProfileModal");
  const avatarImg      = document.getElementById("empProfileAvatar");
  const nameDisplay    = document.getElementById("empProfileName");
  const statusEl       = document.getElementById("empProfileStatus");
  const activeEl       = document.getElementById("empProfileActive");
  const doneEl         = document.getElementById("empProfileDone");
  const shiftStartEl   = document.getElementById("empProfileShiftStart");
  const shiftEndEl     = document.getElementById("empProfileShiftEnd");
  const shiftBtn       = document.getElementById("empProfileShiftBtn");
  const tasksBtn       = document.getElementById("empProfileTasksBtn");
  const closeBtn       = document.getElementById("empProfileClose");
  const editBtn        = document.getElementById("empProfileEditBtn");
  const deleteBtn      = document.getElementById("empProfileDeleteBtn");

  let _currentEmpId      = null;
  let _currentData       = null;
  let _isCurrentlyActive = false;

  const ICON_PLAY = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const ICON_STOP = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;

  // Форматируем HH:MM из ISO-строки или готового HH:MM
  function toHHMM(val) {
    if (!val || val === "—") return "—";
    // Если ISO datetime (содержит T или пробел + цифры)
    if (val.length > 5) return val.slice(11, 16) || val.slice(0, 5);
    return val;
  }

  // Текущее время HH:MM (клиентское, для мгновенного отклика)
  function nowHHMM() {
    const d = new Date();
    return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
  }

  // Отрисовываем блок времён смены
  function renderShiftTimes(startTime, endTime, isOn) {
    const start = toHHMM(startTime);
    const end   = toHHMM(endTime);
    const hasStart = start && start !== "—";

    if (shiftStartEl) {
      shiftStartEl.textContent = hasStart ? start : "—";
      shiftStartEl.className   = "epm-st-value";
    }
    if (shiftEndEl) {
      if (!hasStart) {
        shiftEndEl.textContent = "—";
        shiftEndEl.className   = "epm-st-value";
      } else if (isOn) {
        shiftEndEl.textContent = "Идёт смена";
        shiftEndEl.className   = "epm-st-value epm-st-active";
      } else if (end && end !== "—") {
        shiftEndEl.textContent = end;
        shiftEndEl.className   = "epm-st-value";
      } else {
        shiftEndEl.textContent = "—";
        shiftEndEl.className   = "epm-st-value epm-st-muted";
      }
    }
  }

  function applyShiftBtnState(isOn, canToggle) {
    if (!shiftBtn) return;
    shiftBtn.disabled = !canToggle;
    if (isOn) {
      shiftBtn.className = "epm-btn epm-btn-shift epm-shift-stop";
      shiftBtn.innerHTML = `${ICON_STOP} Завершить смену`;
    } else {
      shiftBtn.className = "epm-btn epm-btn-shift epm-shift-start";
      shiftBtn.innerHTML = `${ICON_PLAY} Начать смену`;
    }
  }

  function closeModal() {
    overlay.style.display = "none";
    _currentEmpId      = null;
    _currentData       = null;
    _isCurrentlyActive = false;
  }

  closeBtn?.addEventListener("click", closeModal);
  overlay?.addEventListener("click", e => { if (e.target === overlay) closeModal(); });

  deleteBtn?.addEventListener("click", () => {
    if (!_currentEmpId || !_currentData) return;
    const empName = _currentData.name || "Сотрудник";
    confirmDelete(() => {
      fetch(`/api/employees/${_currentEmpId}`, { method: "DELETE" })
        .then(r => r.json())
        .then(() => {
          closeModal();
          loadEmployees();
        })
        .catch(() => alert("Ошибка при удалении сотрудника"));
    }, {
      title: "Удалить сотрудника?",
      text: `«${empName}» будет удалён безвозвратно.`,
      okLabel: "Удалить"
    });
  });

  // «Изменить» — открывает модалку редактирования поверх
  editBtn?.addEventListener("click", () => {
    if (_currentEmpId && _currentData) window["openEmpEditModal"](_currentEmpId, _currentData);
  });

  // Начать / завершить смену
  shiftBtn?.addEventListener("click", async () => {
    if (shiftBtn.disabled) return;
    shiftBtn.disabled = true;
    const wasActive = _isCurrentlyActive;

    // Проверка раннего завершения (< 6 мин)
    if (wasActive && _currentData?.shiftStartISO) {
      const elapsedMin = (Date.now() - new Date(_currentData.shiftStartISO).getTime()) / 60000;
      if (elapsedMin < 6) {
        const confirmed = await showEarlyStopConfirm(Math.floor(elapsedMin));
        if (!confirmed) { shiftBtn.disabled = false; return; }
      }
    }

    try {
      const url = `${API}/api/employees/${_currentEmpId}/${wasActive ? "stop" : "start"}`;
      const res = await fetch(url, { method: "PATCH" });
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));

      _isCurrentlyActive = !wasActive;
      const nowOn = _isCurrentlyActive;

      // Обновляем кнопку и статус
      applyShiftBtnState(nowOn, true);
      statusEl.textContent = nowOn ? "На смене" : "Вне смены";
      statusEl.className   = "emp-profile-status " + (nowOn ? "on" : "off");

      // Обновляем блок времён смены мгновенно
      if (nowOn) {
        // Начата: берём время из ответа сервера, иначе текущее
        const startStr = payload.start ? toHHMM(payload.start) : nowHHMM();
        if (_currentData) _currentData.startTime = startStr;
        renderShiftTimes(startStr, "—", true);
      } else {
        // Завершена: конец = текущее время клиента
        const endStr = nowHHMM();
        const startStr = _currentData?.startTime || "—";
        if (_currentData) _currentData.endTime = endStr;
        renderShiftTimes(startStr, endStr, false);
      }

      // Синхронизируем _currentData
      if (_currentData) {
        _currentData.isActive   = nowOn;
        _currentData.statusText = nowOn ? "На смене" : "Вне смены";
      }

      // Обновляем карточки в фоне
      invalidateEmployeeCache();
      refreshEmployees();
    } catch { /* SSE обновит */ }
    finally { shiftBtn.disabled = false; }
  });

  // «Задания» — закрываем профиль, потом открываем задания (избегаем конфликт z-index)
  tasksBtn?.addEventListener("click", () => {
    if (!_currentEmpId || !_currentData?.date) return;
    const empId = _currentEmpId;
    const date  = _currentData.date;
    closeModal();
    openTasksModalForEmployee(empId, date);
  });

  // Вызывается из edit-модалки после сохранения
  window.refreshEmpProfileView = function(empId, newName, newAvatarUrl) {
    if (_currentEmpId !== empId) return;
    if (newName && nameDisplay)    nameDisplay.textContent = newName;
    if (newAvatarUrl && avatarImg) avatarImg.src = newAvatarUrl;
    if (_currentData) {
      if (newName)      _currentData.name      = newName;
      if (newAvatarUrl) _currentData.avatarUrl = newAvatarUrl;
    }
  };

  const ratingEl = document.getElementById("empProfileRating");

  // Публичная функция открытия
  window.openEmpProfileModal = function(empId, data) {
    if (!overlay) return;
    _currentEmpId      = empId;
    _currentData       = data;
    _isCurrentlyActive = !!data.isActive;

    avatarImg.src = data.avatarUrl;
    avatarImg.alt = data.name;
    nameDisplay.textContent = data.name;
    if (ratingEl) ratingEl.innerHTML = data.ratingHtml || "";

    const isOn = _isCurrentlyActive;
    statusEl.textContent = data.statusText || "—";
    statusEl.className   = "emp-profile-status " + (isOn ? "on" : "off");

    activeEl.textContent = data.activeTasks;
    doneEl.textContent   = data.doneTasks;

    renderShiftTimes(data.startTime, data.endTime, isOn);
    applyShiftBtnState(isOn, !!data.canToggleShift);

    overlay.style.display = "flex";
  };
})();

/* ─── Модалка редактирования сотрудника ─────────────────────────── */
(function initEmpEditModal() {
  const overlay       = document.getElementById("empEditModal");
  const closeBtn      = document.getElementById("empEditClose");
  const cancelBtn     = document.getElementById("empEditCancel");
  const saveBtn       = document.getElementById("empEditSave");
  const nameInput     = document.getElementById("empEditNameInput");
  const passwordInput = document.getElementById("empEditPasswordInput");
  const photoInput    = document.getElementById("empEditPhotoInput");
  const avatarPreview = document.getElementById("empEditAvatarPreview");
  const errorEl       = document.getElementById("empEditError");
  const eyeBtn        = document.getElementById("empEditPasswordToggle");
  const eyeIcon       = document.getElementById("empEditEyeIcon");

  const EYE_OPEN  = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const EYE_CLOSE = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`;

  eyeBtn?.addEventListener("click", () => {
    if (!passwordInput) return;
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    if (eyeIcon) eyeIcon.innerHTML = isHidden ? EYE_CLOSE : EYE_OPEN;
  });

  // Фильтр: только цифры в поле пароля
  passwordInput?.addEventListener("input", function() {
    const pos = this.selectionStart;
    const filtered = this.value.replace(/\D/g, "");
    if (this.value !== filtered) {
      this.value = filtered;
      this.setSelectionRange(pos - 1, pos - 1);
    }
    const errEl = document.getElementById("editEmpPwdError");
    if (errEl) { errEl.textContent = ""; errEl.classList.remove("visible"); }
    if (passwordInput) passwordInput.classList.remove("field-error");
  });

  let _currentEmpId    = null;
  let _newPhotoData    = null;
  let _newPhotoFile    = null;
  let _originalPassword = "";

  function closeModal() {
    overlay.style.display = "none";
    _currentEmpId    = null;
    _newPhotoData    = null;
    _newPhotoFile    = null;
    _originalPassword = "";
    if (photoInput)    photoInput.value = "";
    if (errorEl)       errorEl.textContent = "";
    if (passwordInput) { passwordInput.value = ""; passwordInput.type = "password"; passwordInput.classList.remove("field-error"); }
    if (eyeIcon)       eyeIcon.innerHTML = EYE_OPEN;
    const editPwdErr = document.getElementById("editEmpPwdError");
    if (editPwdErr)  { editPwdErr.textContent = ""; editPwdErr.classList.remove("visible"); }
  }

  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);
  overlay?.addEventListener("click", e => { if (e.target === overlay) closeModal(); });

  // Выбор нового фото
  photoInput?.addEventListener("change", e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { photoInput.value = ""; return; }
    _newPhotoFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      _newPhotoData = reader.result;
      avatarPreview.src = _newPhotoData;
    };
    reader.readAsDataURL(file);
  });

  function _editShowPwdError(msg) {
    const errEl = document.getElementById("editEmpPwdError");
    if (errEl)         { errEl.textContent = msg; errEl.classList.add("visible"); }
    if (passwordInput) passwordInput.classList.add("field-error");
  }
  function _editClearPwdError() {
    const errEl = document.getElementById("editEmpPwdError");
    if (errEl)         { errEl.textContent = ""; errEl.classList.remove("visible"); }
    if (passwordInput) passwordInput.classList.remove("field-error");
  }

  // Сохранить
  saveBtn?.addEventListener("click", async () => {
    const name = (nameInput?.value || "").trim();
    if (!name) { errorEl.textContent = "Имя не может быть пустым"; return; }
    errorEl.textContent = "";
    _editClearPwdError();

    const pwd = (passwordInput?.value || "").trim();
    if (pwd !== _originalPassword) {
      if (!/^\d{4,}$/.test(pwd)) {
        _editShowPwdError(pwd.length < 4 ? "Пароль должен содержать минимум 4 цифры" : "Пароль может состоять только из цифр (0–9)");
        return;
      }
    }

    saveBtn.disabled = true;

    const body = { name };
    let newAvatarUrl = null;
    if (_newPhotoFile) {
      try {
        const fd = new FormData();
        fd.append("avatar", _newPhotoFile);
        const upR = await fetch(API + "/api/upload/avatar", { method: "POST", body: fd });
        if (upR.ok) { const upJ = await upR.json(); body.avatar = upJ.url; newAvatarUrl = API + upJ.url; }
        else body.avatar = _newPhotoData;
      } catch { body.avatar = _newPhotoData; }
    } else if (_newPhotoData !== null) {
      body.avatar = _newPhotoData;
    }
    if (pwd !== _originalPassword) body.password = pwd;

    try {
      const res = await fetch(`${API}/api/employees/${_currentEmpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        errorEl.textContent = d.error || "Ошибка при сохранении";
        return;
      }
      // Обновляем просмотровую модалку немедленно
      window.refreshEmpProfileView?.(_currentEmpId, name, newAvatarUrl || _newPhotoData || undefined);
      invalidateEmployeeCache();
      closeModal();
      // SSE вызовет рефреш карточек
    } catch { errorEl.textContent = "Ошибка сети"; }
    finally  { saveBtn.disabled = false; }
  });

  // Публичная функция открытия
  window["openEmpEditModal"] = async function(empId, data) {
    if (!overlay) return;
    _currentEmpId = empId;
    _newPhotoData = null;
    _newPhotoFile = null;

    avatarPreview.src = data.avatarUrl || "";
    avatarPreview.alt = data.name      || "";
    nameInput.value   = data.name      || "";
    if (errorEl) errorEl.textContent = "";
    overlay.style.display = "flex";

    // Fetch fresh employee data to get the correct current password (bypasses cache)
    try {
      const fresh = await fetch(`${API}/api/employees/${empId}`).then(r => r.json());
      _originalPassword = fresh.password || "";
    } catch {
      _originalPassword = data.password || "";
    }
    if (passwordInput) { passwordInput.value = _originalPassword; passwordInput.type = "text"; }
    if (eyeIcon)       eyeIcon.innerHTML = EYE_CLOSE;
  };
})();

function updateCalendarUI(date) {
  const btn = document.getElementById("calendarToggle");
  if (!btn || !date) return;
  const [y, m, dNum] = date.split("-");
  const d = new Date(Number(y), Number(m) - 1, Number(dNum));
  const weekday = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()];
  const day = d.getDate().toString().padStart(2, "0");
  btn.textContent = `${weekday} ${day} ▼`;
}

window.updateCalendarUI = updateCalendarUI;





document.addEventListener("DOMContentLoaded", () => {
  const dropdown = document.querySelector(".calendar-dropdown");
  const toggle = document.getElementById("calendarToggle");
  const menu = document.getElementById("calendarMenu");

  if (!dropdown || !toggle || !menu) return;

  window.selectedCalendarDate = getLocalISODate();
  window.manualDateSelected = false;
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();

  function renderCalendarMenu() {
    menu.innerHTML = "";
    const monthName = new Date(currentYear, currentMonth).toLocaleString("ru-RU", { month: "long" });
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.padding = "6px 8px";
    header.innerHTML = `
      <span class="prevMonth" style="cursor:pointer;">◀️</span>
      <span>${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${currentYear}</span>
      <span class="nextMonth" style="cursor:pointer;">▶️</span>
    `;
    menu.appendChild(header);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(7, 1fr)";
    grid.style.gap = "4px";
    grid.style.padding = "6px";
    menu.appendChild(grid);

    const todayISO = getLocalISODate();

    for (let d = 1; d <= daysInMonth; d++) {
      const isoDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const div = document.createElement("div");
      div.textContent = d;
      div.style.textAlign = "center";
      div.style.padding = "6px";
      div.style.cursor = "pointer";

      if (isoDate === todayISO) div.style.border = "1px solid #4ea6ff";
      if (isoDate === window.selectedCalendarDate) {
        div.style.background = "#4ea6ff";
        div.style.color = "#fff";
      }

      div.addEventListener("click", async () => {
        window.manualDateSelected = true;
        window.selectedCalendarDate = isoDate;
        updateCalendarUI(isoDate);
        dropdown.classList.remove("open");
        await loadEmployeesForDate(isoDate);
      });

      grid.appendChild(div);
    }

    header.querySelector(".prevMonth").onclick = () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderCalendarMenu();
    };

    header.querySelector(".nextMonth").onclick = () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderCalendarMenu();
    };
  }

  toggle.addEventListener("click", () => {
    dropdown.classList.toggle("open");
    renderCalendarMenu();
  });



  toggle.addEventListener("click", e => e.stopPropagation());
  menu.addEventListener("click", e => e.stopPropagation());

  document.addEventListener("click", e => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove("open");
  });

  updateCalendarUI(window.selectedCalendarDate);
  loadEmployeesForDate(window.selectedCalendarDate);
});


document.addEventListener("DOMContentLoaded", () => {
  const dropdown = document.getElementById("taskCalendarDropdown");
  const toggle = document.getElementById("taskCalendarToggle");
  const menu = document.getElementById("taskCalendarMenu");
  const select = document.getElementById("taskDateSelect");

  if (!dropdown || !toggle || !menu) return;

  const baseDate = selectedDate || getLocalISODate();
  const [baseY, baseM] = baseDate.split("-");
  let currentYear = Number(baseY);
  let currentMonth = Number(baseM) - 1;

  function renderTaskCalendarMenu() {
    menu.innerHTML = "";
    const monthName = new Date(currentYear, currentMonth).toLocaleString("ru-RU", { month: "long" });
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.padding = "6px 8px";
    header.innerHTML = `
      <span class="prevMonth" style="cursor:pointer;">◀️</span>
      <span>${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${currentYear}</span>
      <span class="nextMonth" style="cursor:pointer;">▶️</span>
    `;
    menu.appendChild(header);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(7, 1fr)";
    grid.style.gap = "4px";
    grid.style.padding = "6px";
    menu.appendChild(grid);

    const todayISO = getLocalISODate();

    for (let d = 1; d <= daysInMonth; d++) {
      const isoDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hasTasks = availableDates.includes(isoDate);
      const isToday = isoDate === todayISO;
      const isClickable = hasTasks || isToday;
      const div = document.createElement("div");
      div.textContent = d;
      div.style.textAlign = "center";
      div.style.padding = "6px";
      div.style.cursor = isClickable ? "pointer" : "not-allowed";
      div.style.opacity = isClickable ? "1" : "0.35";

      if (isToday) div.style.border = "1px solid #4ea6ff";
      if (hasTasks) div.style.color = "#e5e9f0";
      if (isoDate === selectedDate) {
        div.style.background = "#4ea6ff";
        div.style.color = "#fff";
      }

      div.addEventListener("click", async () => {
        if (!isClickable) return;
        selectedDate = isoDate;
        updateTaskCalendarUI(isoDate);
        if (select) {
          const hasOption = Array.from(select.options).some(o => o.value === isoDate);
          if (!hasOption) {
            const opt = document.createElement("option");
            opt.value = isoDate;
            opt.textContent = isoDate;
            select.appendChild(opt);
          }
          select.value = isoDate;
        }
        dropdown.classList.remove("open");
        await loadTasksTable();
      });

      grid.appendChild(div);
    }

    header.querySelector(".prevMonth").onclick = () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderTaskCalendarMenu();
    };

    header.querySelector(".nextMonth").onclick = () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderTaskCalendarMenu();
    };
  }

  toggle.addEventListener("click", () => {
    const current = selectedDate || getLocalISODate();
    const [y, m] = current.split("-");
    currentYear = Number(y);
    currentMonth = Number(m) - 1;
    dropdown.classList.toggle("open");
    renderTaskCalendarMenu();
  });

  toggle.addEventListener("click", e => e.stopPropagation());
  menu.addEventListener("click", e => e.stopPropagation());

  document.addEventListener("click", e => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove("open");
  });

  updateTaskCalendarUI(baseDate);
});




/* ═══════════════════════════════════════════════════════════════════
   ФОТО ЗАДАНИЙ
   ═══════════════════════════════════════════════════════════════════ */

/* ── Состояние ───────────────────────────────────────────────────── */
let _addTaskPhotos     = []; // { data: base64, file: File }  — для модалки добавления
let _editTaskNewPhotos = []; // { data: base64, file: File }  — новые фото при редактировании
let _editTaskDeleteIds = []; // id[]              — ID существующих фото к удалению

/* ── Хелпер: читаем File → base64 ───────────────────────────────── */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── Рендер превью для модалки ДОБАВЛЕНИЯ ───────────────────────── */
function renderAddTaskPreviews() {
  const grid = document.getElementById("addTaskPhotoPreviews");
  if (!grid) return;
  grid.innerHTML = "";
  _addTaskPhotos.forEach((p, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "task-photo-thumb";
    wrap.innerHTML = `<img src="${p.data}" alt="">
      <button class="task-photo-thumb-del" title="Удалить">×</button>`;
    wrap.querySelector("img").onclick = () => openLightbox(_addTaskPhotos.map(x => x.data), idx);
    wrap.querySelector(".task-photo-thumb-del").onclick = e => {
      e.stopPropagation();
      _addTaskPhotos.splice(idx, 1);
      renderAddTaskPreviews();
    };
    grid.appendChild(wrap);
  });
}

/* ── Рендер превью для модалки РЕДАКТИРОВАНИЯ ───────────────────── */
function renderEditTaskPreviews(taskId, existingPhotos) {
  const grid = document.getElementById("editTaskPhotoPreviews");
  if (!grid) return;
  grid.innerHTML = "";

  // Существующие фото (admin only) без помеченных к удалению
  const visible = existingPhotos.filter(p => !p.employee_id && !_editTaskDeleteIds.includes(p.id));
  const photoSrc = p => p.photo_path ? (API + p.photo_path) : p.photo_data;
  const allSrcs = [
    ...visible.map(photoSrc),
    ..._editTaskNewPhotos.map(p => p.data)
  ];

  visible.forEach((p, vi) => {
    const wrap = document.createElement("div");
    wrap.className = "task-photo-thumb";
    wrap.innerHTML = `<img src="${photoSrc(p)}" alt="">
      <button class="task-photo-thumb-del" title="Удалить">×</button>`;
    wrap.querySelector("img").onclick = () => openLightbox(allSrcs, vi);
    wrap.querySelector(".task-photo-thumb-del").onclick = e => {
      e.stopPropagation();
      _editTaskDeleteIds.push(p.id);
      renderEditTaskPreviews(taskId, existingPhotos);
    };
    grid.appendChild(wrap);
  });

  _editTaskNewPhotos.forEach((p, ni) => {
    const wrap = document.createElement("div");
    wrap.className = "task-photo-thumb";
    wrap.innerHTML = `<img src="${p.data}" alt="">
      <button class="task-photo-thumb-del" title="Удалить">×</button>`;
    wrap.querySelector("img").onclick = () => openLightbox(allSrcs, visible.length + ni);
    wrap.querySelector(".task-photo-thumb-del").onclick = e => {
      e.stopPropagation();
      _editTaskNewPhotos.splice(ni, 1);
      renderEditTaskPreviews(taskId, existingPhotos);
    };
    grid.appendChild(wrap);
  });
}

/* ── Загрузить и показать фото в превью редактирования ──────────── */
async function fetchAndRenderEditTaskPhotos(taskId) {
  const photos = await fetch(`${API}/api/tasks/${taskId}/photos`).then(r => r.json()).catch(() => []);
  // Показываем только admin-фото в превью (employee-фото — в галерее)
  const adminPhotos = photos.filter(p => !p.employee_id);
  renderEditTaskPreviews(taskId, adminPhotos);

  // Настраиваем input для новых фото
  const input = document.getElementById("editTaskPhotoInput");
  if (input) {
    input.onchange = null;
    input.value    = "";
    input.onchange = async e => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > 3 * 1024 * 1024) { alert(`Файл «${f.name}» больше 3 МБ`); continue; }
        const data = await readFileAsBase64(f);
        _editTaskNewPhotos.push({ data, file: f });
      }
      input.value = "";
      renderEditTaskPreviews(taskId, adminPhotos);
    };
  }
}

/* ── Инициализация загрузки фото в модалке ДОБАВЛЕНИЯ ───────────── */
(function initAddTaskPhotoUpload() {
  const input = document.getElementById("addTaskPhotoInput");
  if (!input) return;
  input.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 3 * 1024 * 1024) { alert(`Файл «${f.name}» больше 3 МБ`); continue; }
      const data = await readFileAsBase64(f);
      _addTaskPhotos.push({ data, file: f });
    }
    input.value = "";
    renderAddTaskPreviews();
  });
})();

/* ── Галерея фото (#taskPhotosModal) ────────────────────────────── */
/* ── Модалка комментариев к заданию (чат) ───────────────────────── */
async function openTaskCommentsModal(taskId, isDone = false) {
  const modal   = document.getElementById("taskCommentsModal");
  const listEl  = document.getElementById("taskCommentsList");
  const textInp = document.getElementById("taskCommentText");
  const addBtn  = document.getElementById("addTaskCommentBtn");
  const closeBtn = document.getElementById("closeTaskCommentsBtn");
  if (!modal || !listEl || !textInp || !addBtn) return;

  // ── Вспомогательные ─────────────────────────────────────────────
  function fmtTime(str) {
    if (!str) return "";
    // SQLite хранит без TZ — добавляем +05:00 для TJ
    const d = new Date(str.replace(" ", "T"));
    if (isNaN(d.getTime())) return str;
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function appendMessage(c) {
    const empty = listEl.querySelector(".tc-chat-empty");
    if (empty) empty.remove();
    const isAdmin = (c.author || "").trim() === "Админ";
    const dirClass  = isAdmin ? "tc-msg--admin" : "tc-msg--employee";
    const authorCls = isAdmin ? "tc-msg-author--admin" : "tc-msg-author--employee";
    const authorLbl = isAdmin ? "Админ" : escapeHtml(c.author || "Сотрудник");
    const msg = document.createElement("div");
    msg.className = "tc-msg " + dirClass;
    msg.dataset.cid = c.id;
    msg.innerHTML =
      `<div class="tc-msg-author ${authorCls}">${authorLbl}</div>` +
      `<div class="tc-msg-bubble">${escapeHtml(String(c.comment || ""))}</div>` +
      `<div class="tc-msg-meta">` +
        `<span class="tc-msg-time">${fmtTime(c.created_at)}</span>` +
        (!isDone ? `<span class="tc-msg-actions">` +
          `<button class="tc-msg-btn tc-msg-edit" title="Редактировать">✏</button>` +
          `<button class="tc-msg-btn tc-msg-del" title="Удалить">✕</button>` +
        `</span>` : ``) +
      `</div>`;

    const editBtn   = msg.querySelector(".tc-msg-edit");
    const delBtn    = msg.querySelector(".tc-msg-del");

    if (editBtn) {
      editBtn.onclick = () => {
        if (msg.classList.contains("tc-msg--editing")) return;
        msg.classList.add("tc-msg--editing");
        const bubbleEl = msg.querySelector(".tc-msg-bubble");
        const original = bubbleEl.textContent;
        const ta = document.createElement("textarea");
        ta.className = "tc-msg-edit-ta";
        ta.value = original;
        ta.rows = Math.max(2, original.split("\n").length);
        bubbleEl.replaceWith(ta);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
        ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; };

        const saveFn = async () => {
          const newText = ta.value.trim();
          if (!newText || newText === original) { cancelFn(); return; }
          try {
            const r = await fetch(`${API}/api/tasks/${taskId}/comments/${c.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ comment: newText })
            });
            if (!r.ok) throw new Error("HTTP " + r.status);
            c.comment = newText;
            const updatedBubble = document.createElement("div");
            updatedBubble.className = "tc-msg-bubble";
            updatedBubble.textContent = newText;
            ta.replaceWith(updatedBubble);
            msg.classList.remove("tc-msg--editing");
          } catch(e) { showChatError("Ошибка при сохранении"); cancelFn(); }
        };
        const cancelFn = () => {
          const restoredBubble = document.createElement("div");
          restoredBubble.className = "tc-msg-bubble";
          restoredBubble.textContent = original;
          ta.replaceWith(restoredBubble);
          msg.classList.remove("tc-msg--editing");
        };
        ta.onkeydown = (e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveFn(); }
          if (e.key === "Escape") cancelFn();
        };
        ta.onblur = () => setTimeout(() => { if (msg.classList.contains("tc-msg--editing")) saveFn(); }, 150);
      };
    }

    if (delBtn) {
      delBtn.onclick = async () => {
        if (!confirm("Удалить комментарий?")) return;
        try {
          const r = await fetch(`${API}/api/tasks/${taskId}/comments/${c.id}`, { method: "DELETE" });
          if (!r.ok) throw new Error("HTTP " + r.status);
          msg.remove();
          if (!listEl.querySelector(".tc-msg")) {
            listEl.innerHTML = `<div class="tc-chat-empty">Комментариев пока нет</div>`;
          }
        } catch(e) { showChatError("Ошибка при удалении"); }
      };
    }

    listEl.appendChild(msg);
    listEl.scrollTop = listEl.scrollHeight;
  }

  function showChatError(msg) {
    let errEl = listEl.querySelector(".tc-chat-err");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "tc-chat-err";
      errEl.style.cssText = "color:#ff6b6b;font-size:12px;text-align:center;padding:4px 0;";
      listEl.appendChild(errEl);
    }
    errEl.textContent = msg;
    setTimeout(() => errEl.remove(), 4000);
  }

  // ── Рендер фото-пузыря ──────────────────────────────────────────
  function appendPhoto(p) {
    const empty = listEl.querySelector(".tc-chat-empty");
    if (empty) empty.remove();
    const isAdminPhoto = !p.employee_id;
    const dirCls   = isAdminPhoto ? "tc-msg--admin"          : "tc-msg--employee";
    const authCls  = isAdminPhoto ? "tc-msg-author--admin"   : "tc-msg-author--employee";
    const authLbl  = isAdminPhoto ? "Админ" : escapeHtml(p.employee_name || `Сотрудник #${p.employee_id}`);
    const src      = p.photo_path ? (API + p.photo_path) : (p.photo_data || "");
    const msg = document.createElement("div");
    msg.className  = "tc-msg " + dirCls;
    msg.dataset.pid = p.id;
    msg.innerHTML =
      `<div class="tc-msg-author ${authCls}">${authLbl}</div>` +
      `<div class="tc-msg-photo-wrap">` +
        `<img class="tc-msg-photo" src="${escapeHtml(src)}" alt="Фото" loading="lazy">` +
        (!isDone ? `<button class="tc-msg-photo-del" title="Удалить">×</button>` : "") +
      `</div>` +
      `<div class="tc-msg-meta"><span class="tc-msg-time">${fmtTime(p.created_at)}</span></div>`;

    msg.querySelector(".tc-msg-photo")?.addEventListener("click", () => {
      if (typeof openLightbox === "function") openLightbox([src], 0);
    });
    if (!isDone) {
      msg.querySelector(".tc-msg-photo-del")?.addEventListener("click", async () => {
        if (!confirm("Удалить фото?")) return;
        try {
          const r = await fetch(`${API}/api/tasks/photos/${p.id}`, { method: "DELETE" });
          if (!r.ok) throw new Error("HTTP " + r.status);
          msg.remove();
          if (!listEl.querySelector(".tc-msg")) {
            listEl.innerHTML = `<div class="tc-chat-empty">Комментариев и фото пока нет</div>`;
          }
        } catch(e) { showChatError("Ошибка при удалении фото"); }
      });
    }
    listEl.appendChild(msg);
    listEl.scrollTop = listEl.scrollHeight;
  }

  // ── Загрузка комментариев и фото ────────────────────────────────
  async function loadAll() {
    listEl.innerHTML = `<div class="tc-chat-loading">Загрузка…</div>`;
    try {
      const [comments, photos] = await Promise.all([
        fetch(`${API}/api/tasks/${taskId}/comments`).then(r => r.json()).catch(() => []),
        fetch(`${API}/api/tasks/${taskId}/photos`).then(r => r.json()).catch(() => [])
      ]);
      listEl.innerHTML = "";
      const all = [
        ...(Array.isArray(comments) ? comments.map(c => ({ ...c, _type: "comment" })) : []),
        ...(Array.isArray(photos)   ? photos.map(p => ({ ...p, _type: "photo" }))    : [])
      ].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      if (!all.length) {
        listEl.innerHTML = `<div class="tc-chat-empty">Комментариев и фото пока нет</div>`;
        return;
      }
      all.forEach(item => item._type === "comment" ? appendMessage(item) : appendPhoto(item));
    } catch (e) {
      console.error("loadAll error:", e);
      listEl.innerHTML = `<div class="tc-chat-empty">Не удалось загрузить</div>`;
    }
  }

  // ── Отправка ─────────────────────────────────────────────────────
  async function sendComment() {
    const comment = textInp.value.trim();
    if (!comment) { textInp.focus(); return; }

    addBtn.disabled = true;
    try {
      const res = await fetch(`${API}/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "Админ", comment })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Ошибка отправки:", res.status, body);
        showChatError("Ошибка при отправке (" + res.status + ")");
        return;
      }
      const saved = await res.json();
      textInp.value = "";
      textInp.style.height = "auto";
      appendMessage(saved);
    } catch (e) {
      console.error("Ошибка сети:", e);
      showChatError("Нет соединения с сервером");
    } finally {
      addBtn.disabled = false;
      textInp.focus();
    }
  }

  // ── Назначаем обработчики ────────────────────────────────────────
  addBtn.onclick = sendComment;

  textInp.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComment(); }
  };

  textInp.oninput = () => {
    textInp.style.height = "auto";
    textInp.style.height = Math.min(textInp.scrollHeight, 120) + "px";
  };

  if (closeBtn) closeBtn.onclick = () => { modal.style.display = "none"; };

  // ── Привязываем загрузку фото ────────────────────────────────────
  const photoInput    = document.getElementById("tcPhotoFileInput");
  const photoBtnLabel = document.getElementById("tcChatPhotoBtnLabel");
  if (photoBtnLabel) photoBtnLabel.style.display = isDone ? "none" : "";
  if (photoInput && !isDone) {
    photoInput.value = "";
    photoInput.onchange = async () => {
      const file = photoInput.files[0];
      if (!file) return;
      photoInput.value = "";
      if (!file.type.startsWith("image/")) return;
      if (file.size > 5 * 1024 * 1024) { showChatError("Файл больше 5 МБ"); return; }
      try {
        const fd = new FormData(); fd.append("photo", file);
        const upR = await fetch(API + "/api/upload/task-photo", { method: "POST", body: fd });
        if (!upR.ok) throw new Error("Upload failed");
        const { url } = await upR.json();
        const saveR = await fetch(`${API}/api/tasks/${taskId}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_path: url })
        });
        if (!saveR.ok) throw new Error("Save failed");
        const { id: newId } = await saveR.json();
        const allPhotos = await fetch(`${API}/api/tasks/${taskId}/photos`).then(r => r.json()).catch(() => []);
        const saved = allPhotos.find(ph => ph.id === newId);
        appendPhoto(saved || { id: newId, photo_path: url, employee_id: null, created_at: new Date().toISOString() });
      } catch(e) { console.error("Photo upload:", e); showChatError("Ошибка загрузки фото"); }
    };
  }

  // ── Открываем модалку ────────────────────────────────────────────
  textInp.value = "";
  textInp.style.height = "auto";
  modal.style.display = "flex";
  await loadAll();

  // ── Режим только чтения для выполненных заданий ──────────────────
  textInp.disabled = isDone;
  addBtn.disabled  = isDone;

  let hintEl = modal.querySelector(".tc-chat-readonly-hint");
  if (isDone) {
    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.className = "tc-chat-readonly-hint";
      hintEl.textContent = "Для выполненного задания комментарии доступны только для просмотра";
      modal.querySelector(".tc-chat-input-wrap").before(hintEl);
    }
    hintEl.style.display = "";
  } else {
    if (hintEl) hintEl.style.display = "none";
    textInp.focus();
  }
}

async function openTaskPhotosModal(taskId) {
  const modal   = document.getElementById("taskPhotosModal");
  const content = document.getElementById("taskPhotosContent");
  if (!modal || !content) return;

  content.innerHTML = `<div style="color:var(--muted);font-size:13px">Загрузка…</div>`;
  modal.style.display = "flex";

  const [photos, tasks, employees] = await Promise.all([
    fetch(`${API}/api/tasks/${taskId}/photos`).then(r => r.json()).catch(() => []),
    fetchTasks(),
    fetchEmployees(),
  ]);

  const task    = tasks.find(t => t.id === taskId);
  const empMap  = Object.fromEntries(employees.map(e => [e.id, e.name]));
  const allIds  = [...new Set([...(task?.assignedEmployees || []), ...(task?.participants || [])])];

  const adminPhotos = photos.filter(p => !p.employee_id);
  const empPhotos   = photos.filter(p => !!p.employee_id);

  // Группируем по employee_id
  const byEmp = {};
  empPhotos.forEach(p => {
    if (!byEmp[p.employee_id]) byEmp[p.employee_id] = [];
    byEmp[p.employee_id].push(p);
  });

  // Все участники (даже без фото)
  const empIds = allIds.length ? allIds : Object.keys(byEmp).map(Number);

  let html = "";

  // ── Секция администратора ──
  html += `<div class="tp-section">
    <div class="tp-section-label">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      Администратор
    </div>
    ${adminPhotos.length
      ? `<div class="tp-photo-grid" id="tpAdminGrid">${adminPhotos.map((p, i) =>
          `<div class="tp-photo-card" data-src="${i}" data-section="admin">
             <img src="${p.photo_path ? (API + p.photo_path) : p.photo_data}" alt="" loading="lazy">
             <button class="tp-photo-card-del" data-pid="${p.id}" title="Удалить">×</button>
           </div>`).join("")}
         </div>`
      : `<div class="tp-photo-empty">Фото не загружено</div>`}
    <div class="tp-upload-wrap">
      <label class="tp-upload-btn" for="tpAdminPhotoInput">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Загрузить фото
      </label>
      <input id="tpAdminPhotoInput" type="file" accept="image/*" multiple hidden>
    </div>
  </div>`;

  // ── Секция сотрудников ──
  if (empIds.length) {
    html += `<div class="tp-section">
      <div class="tp-section-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        Фото участников
      </div>`;
    empIds.forEach(eid => {
      const eName  = empMap[eid] || `Сотрудник #${eid}`;
      const ePhotos = byEmp[eid] || [];
      html += `<div class="tp-emp-group">
        <div class="tp-emp-name">${escapeHtml(eName)}</div>
        ${ePhotos.length
          ? `<div class="tp-photo-grid" data-empid="${eid}">${ePhotos.map((p, i) =>
              `<div class="tp-photo-card" data-src="${i}" data-section="emp-${eid}">
                 <img src="${p.photo_path ? (API + p.photo_path) : p.photo_data}" alt="" loading="lazy">
                 <button class="tp-photo-card-del" data-pid="${p.id}" title="Удалить">×</button>
               </div>`).join("")}
             </div>`
          : `<div class="tp-photo-empty">Нет фото</div>`}
        <div class="tp-upload-wrap">
          <label class="tp-upload-btn" for="tpEmpPhotoInput_${eid}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Загрузить фото
          </label>
          <input id="tpEmpPhotoInput_${eid}" type="file" accept="image/*" multiple hidden data-empid="${eid}">
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  content.innerHTML = html;

  // Lightbox для admin-фото
  const tpSrc = p => p.photo_path ? (API + p.photo_path) : p.photo_data;
  const adminSrcs = adminPhotos.map(tpSrc);
  content.querySelectorAll("[data-section='admin'] img").forEach((img, i) => {
    img.onclick = () => openLightbox(adminSrcs, i);
  });

  // Lightbox для employee-фото
  empIds.forEach(eid => {
    const ePhotos = byEmp[eid] || [];
    const eSrcs   = ePhotos.map(tpSrc);
    content.querySelectorAll(`[data-section='emp-${eid}'] img`).forEach((img, i) => {
      img.onclick = () => openLightbox(eSrcs, i);
    });
  });

  // Удаление фото
  content.querySelectorAll(".tp-photo-card-del").forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const pid = Number(btn.dataset.pid);
      if (!pid) return;
      await fetch(`${API}/api/tasks/photos/${pid}`, { method: "DELETE" });
      openTaskPhotosModal(taskId); // перерендер
    };
  });

  // Загрузка admin-фото
  const adminInput = document.getElementById("tpAdminPhotoInput");
  if (adminInput) {
    adminInput.onchange = async e => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > 3 * 1024 * 1024) { alert(`Файл «${f.name}» больше 3 МБ`); continue; }
        const fd = new FormData(); fd.append("photo", f);
        const upR = await fetch(API + "/api/upload/task-photo", { method: "POST", body: fd });
        if (!upR.ok) continue;
        const { url } = await upR.json();
        await fetch(`${API}/api/tasks/${taskId}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_path: url })
        });
      }
      adminInput.value = "";
      openTaskPhotosModal(taskId);
    };
  }

  // Загрузка employee-фото
  empIds.forEach(eid => {
    const empInput = document.getElementById(`tpEmpPhotoInput_${eid}`);
    if (!empInput) return;
    empInput.onchange = async e => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > 3 * 1024 * 1024) { alert(`Файл «${f.name}» больше 3 МБ`); continue; }
        const fd = new FormData(); fd.append("photo", f);
        const upR = await fetch(API + "/api/upload/task-photo", { method: "POST", body: fd });
        if (!upR.ok) continue;
        const { url } = await upR.json();
        await fetch(`${API}/api/tasks/${taskId}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_path: url, employeeId: eid })
        });
      }
      empInput.value = "";
      openTaskPhotosModal(taskId);
    };
  });
}

// Закрытие галереи
(function initTaskPhotosModal() {
  const modal    = document.getElementById("taskPhotosModal");
  const closeBtn = document.getElementById("taskPhotosModalClose");
  const closeFoot = document.getElementById("taskPhotosModalCloseBtn");
  const doClose  = () => { if (modal) modal.style.display = "none"; };
  closeBtn?.addEventListener("click",  doClose);
  closeFoot?.addEventListener("click", doClose);
  modal?.addEventListener("click", e => { if (e.target === modal) doClose(); });
})();

/* ── Lightbox ────────────────────────────────────────────────────── */
(function initLightbox() {
  const lb      = document.getElementById("photoLightbox");
  const img     = document.getElementById("plbImg");
  const btnPrev = document.getElementById("plbPrev");
  const btnNext = document.getElementById("plbNext");
  const btnClose = document.getElementById("plbClose");
  const backdrop = lb?.querySelector(".plb-backdrop");

  let _photos = [];
  let _idx    = 0;

  function show(i) {
    _idx = Math.max(0, Math.min(i, _photos.length - 1));
    img.src = _photos[_idx];
    if (btnPrev) btnPrev.disabled = _idx === 0;
    if (btnNext) btnNext.disabled = _idx === _photos.length - 1;
  }

  window.openLightbox = function(photos, startIndex = 0) {
    if (!lb || !photos.length) return;
    _photos = photos;
    show(startIndex);
    lb.style.display = "flex";
    document.body.style.overflow = "hidden";
  };

  function closeLightbox() {
    if (lb) lb.style.display = "none";
    document.body.style.overflow = "";
    _photos = [];
    _idx    = 0;
  }

  btnClose?.addEventListener("click",  closeLightbox);
  backdrop?.addEventListener("click",  closeLightbox);
  btnPrev?.addEventListener("click",   () => show(_idx - 1));
  btnNext?.addEventListener("click",   () => show(_idx + 1));

  document.addEventListener("keydown", e => {
    if (lb?.style.display !== "flex") return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); show(_idx - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(_idx + 1); }
    if (e.key === "Escape")     { e.preventDefault(); closeLightbox(); }
  });
})();

/* ─── Глобальный ESC — закрывает верхнюю открытую модалку ──────── */
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  // Порядок приоритета: самые «глубокие» сначала
  const checks = [
    () => { const el = document.getElementById("empEditModal");       if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("empProfileModal");    if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("taskCommentsModal");  if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("tasksModal");         if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("taskPhotosModal");    if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("confirmDeleteModal");  if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("changeLoginModal");   if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("changePasswordModal"); if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("addModal");           if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("advEditModal");        if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("advanceModal");       if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
    () => { const el = document.getElementById("addTaskModal");       if (el?.style.display === "flex") { el.style.display = "none"; wizardGoTo(1); return true; } },
    () => { const el = document.getElementById("editTaskModal");      if (el?.style.display === "flex") { el.style.display = "none"; return true; } },
  ];
  for (const check of checks) { if (check()) break; }
});

/* =====================================================================
   НАСТРОЙКИ УВЕДОМЛЕНИЙ (localStorage)
   ===================================================================== */

function getNotifSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("notificationSettings") || "{}");
    return {
      shiftEnd: s.shiftEnd || "19:20"
    };
  } catch {
    return { shiftEnd: "19:20" };
  }
}

function saveNotifSettings(settings) {
  localStorage.setItem("notificationSettings", JSON.stringify(settings));
}

(function initNotifSettingsModal() {
  const modal     = document.getElementById("notifSettingsModal");
  const openBtn   = document.getElementById("notifSettingsBtn");
  const closeBtn  = document.getElementById("notifSettingsClose");
  const cancelBtn = document.getElementById("notifSettingsCancel");
  const saveBtn   = document.getElementById("notifSettingsSave");
  const endInp    = document.getElementById("notifShiftEnd");
  if (!modal || !openBtn) return;

  function openModal() {
    const s = getNotifSettings();
    endInp.value = s.shiftEnd;
    modal.style.display = "flex";
  }

  function closeModal() {
    modal.style.display = "none";
  }

  openBtn.addEventListener("click",       openModal);
  closeBtn?.addEventListener("click",     closeModal);
  cancelBtn?.addEventListener("click",    closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

  saveBtn?.addEventListener("click", () => {
    saveNotifSettings({
      shiftEnd: endInp.value || "19:20"
    });
    closeModal();
  });
})();

/* =====================================================================
   РАЗДЕЛ: УВЕДОМЛЕНИЯ
   ===================================================================== */

(function initNotificationsSection() {
  const dropdown  = document.getElementById("notifCalendarDropdown");
  const toggle    = document.getElementById("notifCalendarToggle");
  const menu      = document.getElementById("notifCalendarMenu");
  const listEl    = document.getElementById("notificationsList");
  if (!dropdown || !toggle || !menu || !listEl) return;

  let notifDate   = getLocalISODate();
  let currentYear = new Date().getFullYear();
  let currentMonth= new Date().getMonth();

  /* ── Обновить текст кнопки ── */
  function updateNotifToggle(iso) {
    const [y, m, d] = iso.split("-");
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    const wd = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"][dt.getDay()];
    const isToday = iso === getLocalISODate();
    toggle.textContent = isToday
      ? `${wd} ${String(d).padStart(2,"0")} ▼ (сегодня)`
      : `${wd} ${String(d).padStart(2,"0")} ▼`;
  }

  /* ── Рендер меню-календаря ── */
  function renderNotifCalendar() {
    menu.innerHTML = "";
    const todayISO  = getLocalISODate();
    const monthName = new Date(currentYear, currentMonth)
      .toLocaleString("ru-RU", { month: "long" });
    const days = new Date(currentYear, currentMonth + 1, 0).getDate();

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;padding:6px 8px;";
    header.innerHTML = `
      <span class="prevMonth" style="cursor:pointer;">◀️</span>
      <span>${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${currentYear}</span>
      <span class="nextMonth" style="cursor:pointer;">▶️</span>
    `;
    menu.appendChild(header);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:6px;";
    menu.appendChild(grid);

    for (let d = 1; d <= days; d++) {
      const iso = `${currentYear}-${String(currentMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const cell = document.createElement("div");
      cell.textContent = d;
      cell.style.cssText = "text-align:center;padding:6px;cursor:pointer;border-radius:4px;";
      if (iso === todayISO) cell.style.border = "1px solid #4ea6ff";
      if (iso === notifDate) { cell.style.background = "#4ea6ff"; cell.style.color = "#fff"; }
      cell.addEventListener("click", () => {
        notifDate = iso;
        updateNotifToggle(iso);
        dropdown.classList.remove("open");
        loadNotifications(iso);
        currentYear  = Number(iso.split("-")[0]);
        currentMonth = Number(iso.split("-")[1]) - 1;
      });
      grid.appendChild(cell);
    }

    header.querySelector(".prevMonth").onclick = () => {
      if (--currentMonth < 0) { currentMonth = 11; currentYear--; }
      renderNotifCalendar();
    };
    header.querySelector(".nextMonth").onclick = () => {
      if (++currentMonth > 11) { currentMonth = 0; currentYear++; }
      renderNotifCalendar();
    };
  }

  toggle.addEventListener("click", e => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
    renderNotifCalendar();
  });
  menu.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", e => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove("open");
  });

  /* ── Загрузить и отрисовать уведомления ── */
  async function loadNotifications(date) {
    listEl.innerHTML = `<div class="notif-empty">Загрузка...</div>`;
    try {
      const rows = await fetch(`${API}/api/notifications?date=${date}`).then(r => r.json());
      renderNotifications(rows || []);
    } catch {
      listEl.innerHTML = `<div class="notif-empty">Ошибка загрузки</div>`;
    }
  }

  function renderNotifications(rows) {
    listEl.innerHTML = "";

    const ICON_SHIFT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const ICON_TASK  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`;

    const shiftRows    = rows.filter(n => n.notif_type === "shift");
    const deadlineRows = rows.filter(n =>
      n.notif_type === "task_deadline" ||
      (n.notif_type == null && n.task_due_time != null && n.task_due_time !== "")
    );

    const EMPTY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;

    const ICON_CLOCK  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const ICON_TASK_S = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const ICON_GROUP  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

    function makeGroup(icon, iconClass, title, items, makeCard) {
      const group = document.createElement("div");
      group.className = "notif-group";

      const hd = document.createElement("div");
      hd.className = "notif-group-title";
      hd.innerHTML = `
        <span class="notif-group-icon ${iconClass}">${icon}</span>
        <span class="notif-group-label">${title}</span>
        ${items.length ? `<span class="notif-group-badge">${items.length}</span>` : ""}
      `;
      group.appendChild(hd);

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "notif-group-empty";
        empty.innerHTML = `<span class="notif-group-empty-icon">${EMPTY_ICON}</span>Нет уведомлений`;
        group.appendChild(empty);
      } else {
        items.forEach(n => group.appendChild(makeCard(n)));
      }
      return group;
    }

    function makeShiftCard(n) {
      // Имя сотрудника — в заголовке карточки
      const empName = n.employee_name || `Сотрудник #${n.employee_id}`;

      // Незавершённые задания за день (если есть)
      let tasksHtml = "";
      if (n.task_title) {
        const parts = n.task_title.split("|");
        const count = parts[0];
        const names = parts[1] || "";
        tasksHtml = `<div class="notif-card-tasks">
          <span class="notif-card-tasks-count">
            ${ICON_TASK_S}
            Незавершённых заданий: ${escapeHtml(count)}
          </span>
          ${names ? `<span class="notif-card-tasks-names">${escapeHtml(names)}</span>` : ""}
        </div>`;
      }

      const card = document.createElement("div");
      card.className = "notif-card notif-card--shift";
      card.innerHTML = `
        <div class="notif-card-head">
          <span class="notif-card-icon notif-card-icon--warn">${ICON_SHIFT}</span>
          <span class="notif-card-emp">${escapeHtml(empName)}</span>
          <span class="notif-card-time">${n.time || ""}</span>
        </div>
        <div class="notif-card-msg">не завершил смену</div>
        ${tasksHtml}
      `;
      return card;
    }

    function makeDeadlineCard(n) {
      let extra = null;
      try { extra = n.task_extra ? JSON.parse(n.task_extra) : null; } catch { extra = null; }
      const assigned     = extra?.assigned     || [];
      const participants = extra?.participants  || [];

      // Кто не выполнил: сначала ответственные, затем участники
      const whoList = assigned.length ? assigned : participants;
      const whoStr  = whoList.length
        ? whoList.map(escapeHtml).join(", ")
        : "Сотрудник";

      // Детали: название задания, дедлайн, участники (если показаны ответственные)
      let detailsHtml = "";
      if (n.task_title) {
        detailsHtml += `<span class="notif-card-detail notif-card-detail--task">${ICON_TASK_S}${escapeHtml(n.task_title)}</span>`;
      }
      if (n.task_due_time) {
        detailsHtml += `<span class="notif-card-detail notif-card-detail--time">${ICON_CLOCK}<b>Дедлайн:</b> ${escapeHtml(n.task_due_time)}</span>`;
      }
      // Участники показываем только если в заголовке — ответственные
      if (assigned.length && participants.length) {
        detailsHtml += `<span class="notif-card-detail notif-card-detail--part">${ICON_GROUP}<b>Участники:</b> ${participants.map(escapeHtml).join(", ")}</span>`;
      }

      const card = document.createElement("div");
      card.className = "notif-card notif-card--deadline";
      card.innerHTML = `
        <div class="notif-card-head">
          <span class="notif-card-icon notif-card-icon--task">${ICON_TASK}</span>
          <span class="notif-card-emp">${whoStr}</span>
          <span class="notif-card-time">${n.time || ""}</span>
        </div>
        <div class="notif-card-msg">не выполнил задание в срок</div>
        ${detailsHtml ? `<div class="notif-card-details">${detailsHtml}</div>` : ""}
      `;
      return card;
    }

    listEl.appendChild(makeGroup(ICON_SHIFT, "notif-group-icon--shift", "Смена не завершена",          shiftRows,    makeShiftCard));
    listEl.appendChild(makeGroup(ICON_TASK,  "notif-group-icon--task",  "Задания не выполнены в срок", deadlineRows, makeDeadlineCard));
  }

  /* ── SSE: обновлять список если раздел открыт ── */
  document.addEventListener("sseNotifications", () => {
    const section = document.getElementById("notifications");
    if (section && section.classList.contains("active")) {
      loadNotifications(notifDate);
    }
  });

  /* ── Инициализация при открытии раздела ── */
  document.querySelectorAll(".nav-btn[data-section='notifications']").forEach(btn => {
    btn.addEventListener("click", () => loadNotifications(notifDate));
  });

  updateNotifToggle(notifDate);
  currentYear  = Number(notifDate.split("-")[0]);
  currentMonth = Number(notifDate.split("-")[1]) - 1;
})();

let lastTrackedDate = getLocalISODate();

setInterval(async () => {
  const now = getLocalISODate();
  if (now !== lastTrackedDate) {
    console.log("🕛 Новый день:", now);
    lastTrackedDate = now;


    if (!window.manualDateSelected) {
      window.selectedCalendarDate = now;
      updateCalendarUI(now);
      await loadEmployeesForDate(now);
      await refreshTaskDateSelector(true);
      await loadTasksTable();
    }
  }
}, 5 * 1000);


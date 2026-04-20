const API = "http://localhost:3000";

document.getElementById("loginBtn").addEventListener("click", async () => {
  const login = document.getElementById("login").value.trim();
  const password = document.getElementById("password").value.trim();
  const error = document.getElementById("error");

  error.textContent = "";

  const res = await fetch(API + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password })
  });

  if (!res.ok) {
    error.textContent = "Неверные данные";
    return;
  }

  const data = await res.json();
  localStorage.setItem("adminToken", data.token);
  window.location.href = "admin.html";
});

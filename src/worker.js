const encoder = new TextEncoder();
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/public" && request.method === "GET") return getPublic(env);
      if (url.pathname === "/api/setup-status" && request.method === "GET") return setupStatus(env);
      if (url.pathname === "/api/setup" && request.method === "POST") return setup(request, env);
      if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
      if (url.pathname === "/api/logout" && request.method === "POST") return logout(request, env);
      if (url.pathname === "/api/me" && request.method === "GET") return me(request, env);
      if (url.pathname === "/api/settings" && request.method === "PUT") return updateSettings(request, env);
      if (url.pathname === "/api/items" && request.method === "POST") return createItem(request, env);
      const itemMatch = url.pathname.match(/^\/api\/items\/(\d+)$/);
      if (itemMatch && request.method === "PATCH") return updateItem(request, env, Number(itemMatch[1]));
      if (itemMatch && request.method === "DELETE") return deleteItem(request, env, Number(itemMatch[1]));
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
};

async function getPublic(env) {
  const settings = await env.DB.prepare("SELECT * FROM settings WHERE id = 1").first();
  const { results: items } = await env.DB.prepare("SELECT * FROM items ORDER BY sort_order ASC, id ASC").all();
  return json({ settings: settings || null, items });
}

async function setupStatus(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM admins").first();
  return json({ ready: Number(row?.count || 0) > 0 });
}

async function setup(request, env) {
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM admins").first();
  if (Number(existing?.count || 0) > 0) return json({ error: "Setup is already complete." }, 409);
  const { email, password, setupToken } = await request.json();
  if (!env.SETUP_TOKEN || setupToken !== env.SETUP_TOKEN) return json({ error: "Invalid setup token." }, 403);
  if (!validEmail(email) || typeof password !== "string" || password.length < 10) return json({ error: "Use a valid email and a password with at least 10 characters." }, 400);
  const salt = randomToken(16);
  const passwordHash = await derivePassword(password, salt);
  await env.DB.prepare("INSERT INTO admins (email, salt, password_hash) VALUES (?, ?, ?)").bind(email.toLowerCase(), salt, passwordHash).run();
  return createSession(email.toLowerCase(), env);
}

async function login(request, env) {
  const { email, password } = await request.json();
  const admin = await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(String(email || "").toLowerCase()).first();
  if (!admin || typeof password !== "string") return json({ error: "Incorrect email or password." }, 401);
  const candidate = await derivePassword(password, admin.salt);
  if (!timingSafeEqual(candidate, admin.password_hash)) return json({ error: "Incorrect email or password." }, 401);
  return createSession(admin.email, env);
}

async function createSession(email, env) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare("INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)").bind(tokenHash, email, expires).run();
  return json({ email }, 200, { "set-cookie": `zairen_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}` });
}

async function logout(request, env) {
  const token = cookie(request, "zairen_session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": "zairen_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
}

async function me(request, env) {
  const admin = await requireAdmin(request, env);
  return admin instanceof Response ? admin : json({ email: admin.email });
}

async function requireAdmin(request, env) {
  const token = cookie(request, "zairen_session");
  if (!token) return json({ error: "Sign in required." }, 401);
  const session = await env.DB.prepare("SELECT email, expires_at FROM sessions WHERE token_hash = ?").bind(await sha256(token)).first();
  if (!session || Number(session.expires_at) < Math.floor(Date.now() / 1000)) return json({ error: "Session expired." }, 401);
  return session;
}

async function updateSettings(request, env) {
  const admin = await requireAdmin(request, env); if (admin instanceof Response) return admin;
  const body = await request.json();
  const introduction = String(body.introduction || "").trim();
  const telegram = String(body.telegram || "@zairenjan").trim();
  const discord = String(body.discord || "its_zairen").trim();
  await env.DB.prepare("INSERT INTO settings (id, introduction, telegram, discord, updated_at) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET introduction=excluded.introduction, telegram=excluded.telegram, discord=excluded.discord, updated_at=CURRENT_TIMESTAMP").bind(introduction, telegram, discord).run();
  return json({ settings: { introduction, telegram, discord } });
}

async function createItem(request, env) {
  const admin = await requireAdmin(request, env); if (admin instanceof Response) return admin;
  const form = await request.formData();
  const category = String(form.get("category") || "");
  const title = String(form.get("title") || "").trim();
  const description = String(form.get("description") || "").trim();
  const mediaUrl = String(form.get("mediaUrl") || "").trim();
  const mediaType = String(form.get("mediaType") || "link");
  const sortOrder = Number(form.get("sortOrder") || 0);
  if (!["video", "mentorship", "ebook"].includes(category) || !title) return json({ error: "Section and title are required." }, 400);
  if (mediaUrl && !validHttpUrl(mediaUrl)) return json({ error: "Media URL must begin with http:// or https://." }, 400);
  const result = await env.DB.prepare("INSERT INTO items (category,title,description,media_url,media_type,object_key,sort_order) VALUES (?,?,?,?,?,NULL,?) RETURNING *").bind(category, title, description, mediaUrl, mediaType, Number.isFinite(sortOrder) ? sortOrder : 0).first();
  return json({ item: result }, 201);
}

async function updateItem(request, env, id) {
  const admin = await requireAdmin(request, env); if (admin instanceof Response) return admin;
  const body = await request.json();
  if (!["video", "mentorship", "ebook"].includes(body.category) || !String(body.title || "").trim()) return json({ error: "Section and title are required." }, 400);
  const mediaUrl = String(body.mediaUrl || "").trim();
  if (mediaUrl && !validHttpUrl(mediaUrl)) return json({ error: "Media URL must begin with http:// or https://." }, 400);
  const item = await env.DB.prepare("UPDATE items SET category=?, title=?, description=?, media_url=?, media_type=?, object_key=NULL, sort_order=? WHERE id=? RETURNING *").bind(body.category, String(body.title).trim(), String(body.description || "").trim(), mediaUrl, String(body.mediaType || "link"), Number(body.sortOrder || 0), id).first();
  return json({ item });
}

async function deleteItem(request, env, id) {
  const admin = await requireAdmin(request, env); if (admin instanceof Response) return admin;
  await env.DB.prepare("DELETE FROM items WHERE id=?").bind(id).run();
  return json({ ok: true });
}

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 310000 }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function sha256(value) { const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value)); return bytesToHex(new Uint8Array(digest)); }
function bytesToHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randomToken(size) { const bytes = crypto.getRandomValues(new Uint8Array(size)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function timingSafeEqual(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function cookie(request, name) { const value = request.headers.get("cookie") || ""; const match = value.match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return match ? decodeURIComponent(match[1]) : null; }
function validEmail(value) { return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validHttpUrl(value) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } }); }

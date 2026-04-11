"use strict";
const crypto = require("crypto");
const { findUserByEmail, findUserById, createUser, getUsageToday } = require("./db");

const JWT_SECRET   = String(process.env.JWT_SECRET || "changeme-set-jwt-secret-in-env").trim();
const DAILY_LIMITS = { free: 3, premium: 50 };

// ── JWT (HS256, sans dépendance externe) ─────────────────────────────────────

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 7 jours
  })).toString("base64url");
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const [header, claims, sig] = parts;
    const expected = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${claims}`)
      .digest("base64url");
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Mot de passe (scrypt natif Node.js) ──────────────────────────────────────

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(`${salt}:${derived.toString("hex")}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve) => {
    const [salt, stored] = String(storedHash || "").split(":");
    if (!salt || !stored) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(Buffer.from(stored, "hex"), derived));
      } catch {
        resolve(false);
      }
    });
  });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleRegister(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email et mot de passe requis." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Email invalide." });
  if (String(password).length < 8)
    return res.status(400).json({ error: "Mot de passe trop court (8 caractères min)." });
  if (findUserByEmail(email))
    return res.status(409).json({ error: "Cet email est déjà utilisé." });

  const passwordHash = await hashPassword(password);
  const user  = createUser(email, passwordHash, "free");
  const token = signToken({ userId: user.id, email: user.email, tier: user.tier });
  return res.json({ token, email: user.email, tier: user.tier, usageToday: 0, limit: DAILY_LIMITS.free });
}

async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email et mot de passe requis." });

  const user = findUserByEmail(email);
  if (!user) return res.status(401).json({ error: "Email ou mot de passe incorrect." });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Email ou mot de passe incorrect." });

  const usageToday = getUsageToday(user.id);
  const limit      = DAILY_LIMITS[user.tier] || DAILY_LIMITS.free;
  const token      = signToken({ userId: user.id, email: user.email, tier: user.tier });
  return res.json({ token, email: user.email, tier: user.tier, usageToday, limit });
}

function handleMe(req, res) {
  const user = findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  const usageToday = getUsageToday(user.id);
  const limit      = DAILY_LIMITS[user.tier] || DAILY_LIMITS.free;
  return res.json({ email: user.email, tier: user.tier, usageToday, limit });
}

// ── Middleware JWT ────────────────────────────────────────────────────────────

function authenticateJWT(req, res, next) {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer "))
    return res.status(401).json({ error: "Non authentifié." });
  const payload = verifyToken(auth.slice(7));
  if (!payload)
    return res.status(401).json({ error: "Session expirée. Reconnecte-toi." });
  req.user = payload;
  next();
}

module.exports = { handleRegister, handleLogin, handleMe, authenticateJWT };

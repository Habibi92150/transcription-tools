"use strict";
const fs   = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "users.json");

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [], usage: {} }; }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ── Utilisateurs (Firebase UID) ───────────────────────────────────────────────

/**
 * Retourne l'utilisateur correspondant au UID Firebase.
 * Le crée avec tier "free" si absent (premier login).
 */
function getOrCreateUser(uid, email = "") {
  const db = loadDb();
  let user = db.users.find((u) => u.id === uid);
  if (!user) {
    user = {
      id:        uid,
      email:     String(email || "").toLowerCase().trim(),
      tier:      "free",
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDb(db);
  }
  return user;
}

// ── Quota journalier ──────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getUsageToday(userId) {
  const db = loadDb();
  return db.usage?.[userId]?.[todayKey()] || 0;
}

function incrementUsage(userId) {
  const db  = loadDb();
  const day = todayKey();
  if (!db.usage)           db.usage           = {};
  if (!db.usage[userId])   db.usage[userId]   = {};
  db.usage[userId][day] = (db.usage[userId][day] || 0) + 1;
  saveDb(db);
}

module.exports = { getOrCreateUser, getUsageToday, incrementUsage };

"use strict";
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DB_FILE = path.join(__dirname, "users.json");

// ── Lecture / écriture ────────────────────────────────────────────────────────

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { users: [], usage: {} };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ── Utilisateurs ──────────────────────────────────────────────────────────────

function findUserByEmail(email) {
  const key = String(email || "").toLowerCase().trim();
  return loadDb().users.find((u) => u.email === key) || null;
}

function findUserById(id) {
  return loadDb().users.find((u) => u.id === id) || null;
}

/**
 * Crée un utilisateur et le persiste dans users.json.
 * @param {string} email
 * @param {string} passwordHash  - hash scrypt (format "salt:hex")
 * @param {"free"|"premium"} tier
 */
function createUser(email, passwordHash, tier = "free") {
  const db   = loadDb();
  const user = {
    id:           crypto.randomUUID(),
    email:        String(email || "").toLowerCase().trim(),
    passwordHash,
    tier,
    createdAt:    new Date().toISOString(),
  };
  db.users.push(user);
  saveDb(db);
  return user;
}

// ── Quota journalier ──────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
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

module.exports = { findUserByEmail, findUserById, createUser, getUsageToday, incrementUsage };

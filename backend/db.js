"use strict";
const fs   = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "users.json");

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [], processedWebhooks: [] }; }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ── Plans ─────────────────────────────────────────────────────────────────────
const PLAN_CREDITS = { free: 3, starter: 40, pro: 120, growth: 400 };

// ── Utilisateurs ──────────────────────────────────────────────────────────────

function getOrCreateUser(uid, email = "") {
  const db   = loadDb();
  let user   = db.users.find((u) => u.id === uid);
  const isNew = !user;
  if (!user) {
    user = {
      id:                 uid,
      email:              String(email || "").toLowerCase().trim(),
      tier:               "free",
      creditsBalance:     PLAN_CREDITS.free, // 3 crédits offerts au départ
      stripeCustomerId:   null,
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      currentPeriodEnd:   null,
      createdAt:          new Date().toISOString(),
    };
    db.users.push(user);
    saveDb(db);
  }
  // Migration : anciens users sans creditsBalance
  if (user.creditsBalance === undefined || user.creditsBalance === null) {
    user.creditsBalance = user.tier === "free" ? PLAN_CREDITS.free : PLAN_CREDITS[user.tier] ?? PLAN_CREDITS.free;
    const idx = db.users.findIndex((u) => u.id === uid);
    if (idx >= 0) db.users[idx] = user;
    saveDb(db);
  }
  return { user, isNew };
}

// ── Crédits ───────────────────────────────────────────────────────────────────

function getCreditsBalance(uid) {
  const db   = loadDb();
  const user = db.users.find((u) => u.id === uid);
  return user ? Math.max(0, user.creditsBalance ?? 0) : 0;
}

function addCredits(uid, amount) {
  const db   = loadDb();
  const idx  = db.users.findIndex((u) => u.id === uid);
  if (idx < 0) return false;
  db.users[idx].creditsBalance = Math.max(0, (db.users[idx].creditsBalance ?? 0) + amount);
  saveDb(db);
  return true;
}

/**
 * Déduit 1 crédit.
 * @returns {boolean} true si la transcription peut continuer, false si solde = 0.
 */
function deductCredit(uid) {
  const db   = loadDb();
  const idx  = db.users.findIndex((u) => u.id === uid);
  if (idx < 0) return false;
  const balance = db.users[idx].creditsBalance ?? 0;
  if (balance <= 0) return false;
  db.users[idx].creditsBalance = balance - 1;
  saveDb(db);
  return true;
}

/**
 * Reset mensuel des crédits avec rollover de 20% des crédits non utilisés.
 */
function resetCreditsForRenewal(uid, plan) {
  const db      = loadDb();
  const idx     = db.users.findIndex((u) => u.id === uid);
  if (idx < 0) return false;
  const planCredits  = PLAN_CREDITS[plan] ?? PLAN_CREDITS.free;
  const currentBalance = db.users[idx].creditsBalance ?? 0;
  const rollover     = Math.floor(Math.min(currentBalance, planCredits * 0.2));
  db.users[idx].creditsBalance = planCredits + rollover;
  saveDb(db);
  console.log(`[db] renouvellement ${uid}: ${planCredits} + rollover ${rollover} = ${db.users[idx].creditsBalance} crédits`);
  return true;
}

// ── Abonnement Stripe ─────────────────────────────────────────────────────────

function setSubscription(uid, { plan, subscriptionId, status, periodEnd, customerId } = {}) {
  const db  = loadDb();
  const idx = db.users.findIndex((u) => u.id === uid);
  if (idx < 0) return false;
  if (plan)           db.users[idx].tier                 = plan;
  if (subscriptionId) db.users[idx].stripeSubscriptionId = subscriptionId;
  if (status)         db.users[idx].subscriptionStatus   = status;
  if (periodEnd)      db.users[idx].currentPeriodEnd     = periodEnd;
  if (customerId)     db.users[idx].stripeCustomerId     = customerId;
  saveDb(db);
  return true;
}

function getUserByStripeCustomerId(customerId) {
  const db = loadDb();
  return db.users.find((u) => u.stripeCustomerId === customerId) || null;
}

function getUserByStripeSubscriptionId(subscriptionId) {
  const db = loadDb();
  return db.users.find((u) => u.stripeSubscriptionId === subscriptionId) || null;
}

// ── Idempotency webhook ────────────────────────────────────────────────────────

function isWebhookProcessed(eventId) {
  const db = loadDb();
  return (db.processedWebhooks || []).includes(eventId);
}

function markWebhookProcessed(eventId) {
  const db = loadDb();
  if (!db.processedWebhooks) db.processedWebhooks = [];
  if (!db.processedWebhooks.includes(eventId)) {
    db.processedWebhooks.push(eventId);
    // Garde uniquement les 500 derniers pour ne pas grossir indéfiniment
    if (db.processedWebhooks.length > 500) {
      db.processedWebhooks = db.processedWebhooks.slice(-500);
    }
    saveDb(db);
  }
}

module.exports = {
  getOrCreateUser,
  getCreditsBalance,
  addCredits,
  deductCredit,
  resetCreditsForRenewal,
  setSubscription,
  getUserByStripeCustomerId,
  getUserByStripeSubscriptionId,
  isWebhookProcessed,
  markWebhookProcessed,
  PLAN_CREDITS,
};

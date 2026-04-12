"use strict";
const admin = require("firebase-admin");
const path  = require("path");

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT)
    throw new Error("Variable d'env FIREBASE_SERVICE_ACCOUNT manquante.");
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

// ── Middleware Firebase Auth ───────────────────────────────────────────────────
async function authenticateFirebase(req, res, next) {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer "))
    return res.status(401).json({ error: "Non authentifié." });
  try {
    const decoded = await admin.auth().verifyIdToken(auth.slice(7));
    if (!decoded.email_verified) {
      return res.status(403).json({
        error: "Email non vérifié. Vérifie ta boîte mail avant de continuer.",
      });
    }
    req.user = { userId: decoded.uid, email: decoded.email, emailVerified: true };
    next();
  } catch {
    return res.status(401).json({ error: "Session expirée. Reconnecte-toi." });
  }
}

module.exports = { authenticateFirebase };

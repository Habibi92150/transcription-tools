"use strict";
const fs    = require("fs");
const path  = require("path");
const admin = require("firebase-admin");

function loadFirebaseServiceAccount() {
  const fromPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (fromPath) {
    const abs = path.isAbsolute(fromPath)
      ? fromPath
      : path.join(__dirname, fromPath);
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  }
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!inline || !String(inline).trim())
    throw new Error(
      "Variable d'env FIREBASE_SERVICE_ACCOUNT ou FIREBASE_SERVICE_ACCOUNT_PATH manquante."
    );
  const trimmed = String(inline).replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const abs = path.isAbsolute(trimmed)
      ? trimmed
      : path.join(__dirname, trimmed);
    if (fs.existsSync(abs))
      return JSON.parse(fs.readFileSync(abs, "utf8"));
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT n'est pas un JSON valide. Mets le JSON sur une seule ligne, " +
        "échappe les guillemets, ou utilise FIREBASE_SERVICE_ACCOUNT_PATH=chemin/vers/serviceAccount.json"
    );
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadFirebaseServiceAccount()),
  });
}

// ── Middleware Firebase Auth ───────────────────────────────────────────────────
async function authenticateFirebase(req, res, next) {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer "))
    return res.status(401).json({ error: "Non authentifié." });
  try {
    const decoded = await admin.auth().verifyIdToken(auth.slice(7));
    console.log(`[auth] token OK uid=${decoded.uid} email=${decoded.email} verified=${decoded.email_verified}`);
    if (!decoded.email_verified) {
      console.warn(`[auth] email_verified=false pour ${decoded.email}`);
      return res.status(403).json({
        error: "Email non vérifié. Vérifie ta boîte mail avant de continuer.",
      });
    }
    req.user = { userId: decoded.uid, email: decoded.email, emailVerified: true };
    next();
  } catch (err) {
    console.error("[auth] verifyIdToken failed:", err.code || err.message);
    return res.status(401).json({ error: "Session expirée. Reconnecte-toi.", detail: err.code || err.message });
  }
}

module.exports = { authenticateFirebase };

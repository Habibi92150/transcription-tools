"use strict";
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs        = require("fs/promises");
const path      = require("path");
const os        = require("os");
const crypto    = require("crypto");
const express   = require("express");
const cors      = require("cors");
const multer    = require("multer");
const rateLimit = require("express-rate-limit");

const { authenticateFirebase } = require("./auth");
const { handleTranscription }  = require("./transcription");
const {
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
} = require("./db");
const { sendWelcomeMail } = require("./mailer");

const PORT         = Number(process.env.PORT || 8787);
const MAX_FILE_MB  = Number(process.env.MAX_FILE_MB || 600);
const TMP_DIR      = path.join(os.tmpdir(), "transcription-tools");
const FRONTEND_URL = (process.env.FRONTEND_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

// ── Plans & prix Stripe ───────────────────────────────────────────────────────
const PRICE_TO_PLAN = {};
if (process.env.STRIPE_PRICE_STARTER) PRICE_TO_PLAN[process.env.STRIPE_PRICE_STARTER] = "starter";
if (process.env.STRIPE_PRICE_PRO)     PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO]     = "pro";
if (process.env.STRIPE_PRICE_GROWTH)  PRICE_TO_PLAN[process.env.STRIPE_PRICE_GROWTH]  = "growth";

const CREDIT_PACKS = {};
if (process.env.STRIPE_PRICE_PACK_50)  CREDIT_PACKS[process.env.STRIPE_PRICE_PACK_50]  = 50;
if (process.env.STRIPE_PRICE_PACK_150) CREDIT_PACKS[process.env.STRIPE_PRICE_PACK_150] = 150;
if (process.env.STRIPE_PRICE_PACK_500) CREDIT_PACKS[process.env.STRIPE_PRICE_PACK_500] = 500;

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8787,http://localhost:3000")
  .split(",").map((s) => s.trim());

// ── Upload ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try { await fs.mkdir(TMP_DIR, { recursive: true }); cb(null, TMP_DIR); }
    catch (err) { cb(err); }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024 } });

// ── Rate limiters ─────────────────────────────────────────────────────────────
const transcribeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: "Trop de requêtes. Réessaie dans une minute." },
  standardHeaders: true, legacyHeaders: false,
});

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: allowedOrigins, credentials: true }));

// ⚠️  Webhook Stripe → body brut obligatoire AVANT express.json()
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use((req, _res, next) => {
  if (req.path === "/api/webhook") return next();
  express.json()(req, _res, next);
});

// ── Fichiers statiques ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, ".."), { index: "index.html" }));

// ── Santé ─────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ── Config ────────────────────────────────────────────────────────────────────
app.get("/api/config", (_req, res) => res.json({ backendUrl: "" }));

// ── Quota / profil utilisateur ────────────────────────────────────────────────
app.get("/api/quota", authenticateFirebase, (req, res) => {
  const { user, isNew } = getOrCreateUser(req.user.userId, req.user.email);
  if (isNew) sendWelcomeMail(user.email).catch((err) => console.error("[mailer]", err.message));
  return res.json({
    tier:               user.tier,
    creditsBalance:     user.creditsBalance ?? 0,
    subscriptionStatus: user.subscriptionStatus ?? null,
    currentPeriodEnd:   user.currentPeriodEnd  ?? null,
  });
});

// ── Crédits ───────────────────────────────────────────────────────────────────
app.get("/api/me/credits", authenticateFirebase, (req, res) => {
  const { user } = getOrCreateUser(req.user.userId, req.user.email);
  return res.json({
    creditsBalance:     user.creditsBalance     ?? 0,
    tier:               user.tier,
    subscriptionStatus: user.subscriptionStatus ?? null,
    currentPeriodEnd:   user.currentPeriodEnd   ?? null,
  });
});

// ── Stripe : créer une session Checkout ───────────────────────────────────────
app.post("/api/create-checkout-session", authenticateFirebase, async (req, res) => {
  const stripeKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!stripeKey) return res.status(503).json({ error: "Paiement non configuré." });

  const { priceId, type } = req.body || {};
  if (!priceId) return res.status(400).json({ error: "priceId manquant." });

  const mode = type === "pack" ? "payment" : "subscription";

  // Vérifie que le priceId est connu
  if (mode === "subscription" && !PRICE_TO_PLAN[priceId]) {
    return res.status(400).json({ error: "Plan inconnu." });
  }
  if (mode === "payment" && !CREDIT_PACKS[priceId]) {
    return res.status(400).json({ error: "Pack inconnu." });
  }

  const { user } = getOrCreateUser(req.user.userId, req.user.email);
  const stripe   = require("stripe")(stripeKey);

  try {
    // Crée ou réutilise le customer Stripe
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    user.email,
        metadata: { firebaseUid: req.user.userId },
      });
      customerId = customer.id;
      setSubscription(req.user.userId, { customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ["card"],
      line_items:           [{ price: priceId, quantity: 1 }],
      mode,
      success_url: `${FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${FRONTEND_URL}/?checkout=cancel`,
      ...(mode === "subscription" ? {
        subscription_data: { metadata: { firebaseUid: req.user.userId } },
      } : {}),
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("[stripe] checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Stripe : webhook ──────────────────────────────────────────────────────────
app.post("/api/webhook", async (req, res) => {
  const stripeKey     = String(process.env.STRIPE_SECRET_KEY     || "").trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripeKey || !webhookSecret) return res.status(503).json({ error: "Stripe non configuré." });

  const stripe = require("stripe")(stripeKey);
  const sig    = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe] signature invalide:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Idempotency : ignore les events déjà traités
  if (isWebhookProcessed(event.id)) {
    console.log(`[stripe] event ${event.id} déjà traité, skip`);
    return res.json({ received: true });
  }

  console.log(`[stripe] webhook: ${event.type} (${event.id})`);

  try {
    // ── Checkout terminé (nouveau sub ou pack) ────────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session    = event.data.object;
      const customerId = session.customer;
      const user       = getUserByStripeCustomerId(customerId);

      if (!user) {
        console.warn("[stripe] utilisateur introuvable pour customer:", customerId);
      } else if (session.mode === "subscription") {
        const priceId  = session.line_items?.data?.[0]?.price?.id;
        const plan     = PRICE_TO_PLAN[priceId] || "starter";
        const periodEnd = session.subscription
          ? (await stripe.subscriptions.retrieve(session.subscription)).current_period_end
          : null;
        setSubscription(user.id, {
          plan,
          subscriptionId: session.subscription,
          status:         "active",
          periodEnd:      periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        });
        addCredits(user.id, PLAN_CREDITS[plan] ?? 0);
        console.log(`[stripe] ${user.email} → ${plan} (+${PLAN_CREDITS[plan]} crédits)`);
      } else if (session.mode === "payment") {
        // Pack de crédits one-time
        // On récupère le priceId depuis la session
        const sessionWithItems = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["line_items"],
        });
        const priceId = sessionWithItems.line_items?.data?.[0]?.price?.id;
        const credits = CREDIT_PACKS[priceId] ?? 0;
        if (credits > 0) {
          addCredits(user.id, credits);
          console.log(`[stripe] ${user.email} → pack +${credits} crédits`);
        }
      }
    }

    // ── Renouvellement mensuel ────────────────────────────────────────────────
    if (event.type === "invoice.paid") {
      const invoice        = event.data.object;
      const customerId     = invoice.customer;
      const subscriptionId = invoice.subscription;
      // Ne traiter que les renouvellements (pas la première facture — déjà gérée par checkout.session.completed)
      if (invoice.billing_reason === "subscription_cycle") {
        const user = getUserByStripeCustomerId(customerId);
        if (user) {
          // Récupère le plan depuis l'abonnement Stripe
          const sub     = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price?.id;
          const plan    = PRICE_TO_PLAN[priceId] || user.tier;
          resetCreditsForRenewal(user.id, plan);
          setSubscription(user.id, {
            status:    "active",
            periodEnd: new Date(sub.current_period_end * 1000).toISOString(),
          });
          console.log(`[stripe] renouvellement ${user.email} (${plan})`);
        }
      }
    }

    // ── Abonnement modifié (upgrade / downgrade) ──────────────────────────────
    if (event.type === "customer.subscription.updated") {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const user       = getUserByStripeCustomerId(customerId);
      if (user) {
        const priceId = sub.items.data[0]?.price?.id;
        const plan    = PRICE_TO_PLAN[priceId] || user.tier;
        setSubscription(user.id, {
          plan,
          status:    sub.status,
          periodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        });
        console.log(`[stripe] subscription updated ${user.email} → ${plan} (${sub.status})`);
      }
    }

    // ── Abonnement annulé ─────────────────────────────────────────────────────
    if (event.type === "customer.subscription.deleted") {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const user       = getUserByStripeCustomerId(customerId);
      if (user) {
        setSubscription(user.id, { plan: "free", status: "cancelled" });
        console.log(`[stripe] ${user.email} → free (annulation)`);
      }
    }

    // ── Paiement échoué ────────────────────────────────────────────────────────
    if (event.type === "invoice.payment_failed") {
      const invoice    = event.data.object;
      const customerId = invoice.customer;
      const user       = getUserByStripeCustomerId(customerId);
      if (user) {
        setSubscription(user.id, { status: "past_due" });
        console.warn(`[stripe] paiement échoué pour ${user.email}`);
      }
    }

    markWebhookProcessed(event.id);
  } catch (err) {
    console.error("[stripe] erreur traitement webhook:", err.message);
    return res.status(500).json({ error: err.message });
  }

  return res.json({ received: true });
});

// ── Wording (Groq) ────────────────────────────────────────────────────────────
app.post("/api/wording", authenticateFirebase, async (req, res) => {
  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!groqKey) return res.status(503).json({ error: "GROQ_API_KEY non configurée." });

  const { systemPrompt, userPrompt, model, temperature } = req.body || {};
  if (!userPrompt) return res.status(400).json({ error: "userPrompt manquant." });

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:           model       || "llama-3.3-70b-versatile",
        temperature:     temperature ?? 0.82,
        response_format: { type: "json_object" },
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "Erreur Groq." });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Transcription ─────────────────────────────────────────────────────────────
app.post("/api/transcribe", authenticateFirebase, transcribeLimiter, upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) return res.status(400).json({ error: "Aucun fichier fourni." });

  try {
    const { user } = getOrCreateUser(req.user.userId, req.user.email);
    const balance  = user.creditsBalance ?? 0;

    if (balance <= 0) {
      return res.status(402).json({
        error: "Tu n'as plus de crédits. Achète un pack ou abonne-toi pour continuer.",
        creditsBalance: 0,
      });
    }

    // Déduit 1 crédit AVANT la transcription (évite les doubles si timeout)
    const ok = deductCredit(req.user.userId);
    if (!ok) {
      return res.status(402).json({
        error: "Tu n'as plus de crédits. Achète un pack ou abonne-toi pour continuer.",
        creditsBalance: 0,
      });
    }

    const result = await handleTranscription(req, uploadedPath);
    const newBalance = getCreditsBalance(req.user.userId);
    return res.json({ ...result, creditsBalance: newBalance });
  } catch (err) {
    // En cas d'erreur de transcription, rembourse le crédit
    addCredits(req.user.userId, 1);
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    await fs.unlink(uploadedPath).catch(() => {});
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
const httpServer = app.listen(PORT);
httpServer.once("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} déjà utilisé. Ferme l'autre instance ou change PORT dans backend/.env.`);
  } else {
    console.error("Échec du serveur HTTP :", err.message || err);
  }
  process.exit(1);
});
httpServer.once("listening", () => {
  void fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Plans configurés: ${Object.keys(PRICE_TO_PLAN).length} prix abonnement, ${Object.keys(CREDIT_PACKS).length} packs`);
});

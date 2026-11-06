import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import QRCode from "npm:qrcode@1.5.4";

// Phase 2 inventory visibility and label rendering ONLY. No inventory mutations.
// Private unit scan tokens never pass through the customer-facing Nexus catalog.
const corsHeaders = {
  // Intentionally no wildcard CORS: caller origin is validated below.
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};
const allowedOrigins = new Set([
  "https://core.sciencebyhugs.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const corsFor = (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  return {
    ...corsHeaders,
    ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type UnitRow = {
  id: string;
  product_id: string;
  lot_id: string;
  ordinal: number;
  scan_token: string;
  state: string;
};

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const publishable = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (!url || !publishable.default || !secrets.default) return json({ error: "Service unavailable" }, 503);

    const client = createClient(url, publishable.default, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return json({ error: "Session invalid" }, 401);
    const role = String(user.app_metadata?.role || "").trim().toLowerCase();
    if (role !== "owner" && role !== "admin") return json({ error: "Core administrator access required" }, 403);

    const admin = createClient(url, secrets.default, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "Invalid request" }, 400);
    const request = body as Record<string, unknown>;

    if (request.action === "list") {
      // Explicit caps prevent a partial/incorrect count from being presented as complete.
      const { data: lots, error: lotError } = await admin
        .from("inventory_lots")
        .select("id,product_id,internal_lot,supplier_lot,expiry_date,accepted_units,damaged_units")
        .order("created_at", { ascending: false }).limit(101);
      if (lotError) throw lotError;
      if ((lots || []).length > 100) return json({ error: "More than 100 lots; pagination required" }, 409);
      if (!lots?.length) return json({ success: true, lots: [] });

      const lotIds = lots.map(lot => lot.id);
      const productIds = [...new Set(lots.map(lot => lot.product_id))];
      const [{ data: units, error: unitError }, { data: products, error: productError }] = await Promise.all([
        admin.from("inventory_units")
          .select("id,product_id,lot_id,ordinal,scan_token,state")
          .in("lot_id", lotIds).order("ordinal", { ascending: true }).limit(1001),
        admin.from("products").select("id,name,product_code").in("id", productIds),
      ]);
      if (unitError || productError) return json({ error: "Inventory detail unavailable" }, 500);
      if ((units || []).length > 1000) return json({ error: "More than 1000 units; pagination required" }, 409);
      const productById = new Map((products || []).map(product => [product.id, product]));
      const unitByLot = new Map<string, UnitRow[]>();
      for (const unit of (units || []) as UnitRow[]) {
        const existing = unitByLot.get(unit.lot_id) || [];
        existing.push(unit);
        unitByLot.set(unit.lot_id, existing);
      }
      const response = lots.map(lot => ({
        id: lot.id,
        internal_lot: lot.internal_lot,
        supplier_lot: lot.supplier_lot,
        expiry_date: lot.expiry_date,
        accepted_units: lot.accepted_units,
        damaged_units: lot.damaged_units,
        product_id: lot.product_id,
        product_code: productById.get(lot.product_id)?.product_code || null,
        product_name: productById.get(lot.product_id)?.name || "Unknown product",
        units: unitByLot.get(lot.id) || [],
      }));
      return json({ success: true, lots: response });
    }

    if (request.action === "labels") {
      const incoming = request.unitIds;
      if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 50 ||
          incoming.some(value => typeof value !== "string" || !uuid.test(value))) {
        return json({ error: "Select 1 to 50 valid inventory units" }, 400);
      }
      const ids = incoming as string[];
      if (new Set(ids).size !== ids.length) return json({ error: "Duplicate inventory unit" }, 400);

      const { data: units, error: unitError } = await admin
        .from("inventory_units")
        .select("id,product_id,lot_id,ordinal,scan_token,state").in("id", ids);
      if (unitError) throw unitError;
      if (!units || units.length !== ids.length) return json({ error: "Unit not found" }, 404);
      const lotIds = [...new Set(units.map(unit => unit.lot_id))];
      const productIds = [...new Set(units.map(unit => unit.product_id))];
      const [{ data: lots, error: lotError }, { data: products, error: productError }] = await Promise.all([
        admin.from("inventory_lots").select("id,product_id,internal_lot,expiry_date").in("id", lotIds),
        admin.from("products").select("id,product_code,name").in("id", productIds),
      ]);
      if (lotError || productError) throw lotError || productError;
      const lotById = new Map((lots || []).map(lot => [lot.id, lot]));
      const productById = new Map((products || []).map(product => [product.id, product]));
      const unitById = new Map(units.map(unit => [unit.id, unit]));
      const labels = [];
      for (const id of ids) {
        const unit = unitById.get(id)!;
        const lot = lotById.get(unit.lot_id);
        const product = productById.get(unit.product_id);
        if (!lot || !product || lot.product_id !== unit.product_id)
          return json({ error: "Inventory relationship mismatch" }, 409);
        const payload = "SBH:UNIT:" + unit.scan_token.toLowerCase();
        const qr_svg = await QRCode.toString(payload, {
          type: "svg", width: 184, margin: 4, errorCorrectionLevel: "M",
        });
        labels.push({
          unit_id: unit.id,
          product_code: product.product_code,
          product_name: product.name,
          internal_lot: lot.internal_lot,
          expiry_date: lot.expiry_date,
          ordinal: unit.ordinal,
          state: unit.state,
          qr_svg,
        });
      }
      return json({ success: true, labels });
    }

    if (request.action === "lookup") {
      const tokenValue = request.scanToken;
      const token = typeof tokenValue === "string"
        ? tokenValue.trim().replace(/^SBH:UNIT:/i, "") : "";
      if (!uuid.test(token)) return json({ error: "Invalid scan token" }, 400);
      const { data: unit, error: errorUnit } = await admin
        .from("inventory_units")
        .select("id,product_id,lot_id,ordinal,scan_token,state")
        .eq("scan_token", token).maybeSingle();
      if (errorUnit) throw errorUnit;
      if (!unit) return json({ error: "No matching unit" }, 404);
      const [{ data: lot }, { data: product }] = await Promise.all([
        admin.from("inventory_lots")
          .select("internal_lot,supplier_lot,expiry_date").eq("id", unit.lot_id).single(),
        admin.from("products")
          .select("name,product_code").eq("id", unit.product_id).single(),
      ]);
      if (!lot || !product) return json({ error: "Unit record incomplete" }, 409);
      return json({ success: true, unit: {
        id: unit.id, ordinal: unit.ordinal, state: unit.state,
        product_name: product.name, product_code: product.product_code,
        internal_lot: lot.internal_lot, supplier_lot: lot.supplier_lot,
        expiry_date: lot.expiry_date,
      } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    // No raw SQL errors, tokens, or private identifiers returned to the browser.
    console.error("core_inventory_labels_read_failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Inventory request failed" }, 500);
  }
});

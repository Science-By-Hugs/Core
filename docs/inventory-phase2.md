# Phase 2: Core inventory QR labels

Branch: feature/phase2-inventory-qr-labels.

## Design
- Core-only read-only inventory screen. Uses existing inventory_lots and inventory_units.
- Every unit already has a stable unique scan_token; QR payload is SBH:UNIT:<scan_token>.
- Authenticated owner/admin Edge Function returns inventory, QR SVG labels or a unit lookup.
- No public Nexus data, new tables, schema migrations, feature flags, checkout changes or inventory mutations.
- Label stock: 2in wide × 1in high (landscape), no margins, 100% scale.
- Damaged, allocated or otherwise unavailable labels visibly say NOT AVAILABLE.
- Batch print prepares labels first, then a separate user click opens the print dialog.
- Input accepts scanned keyboard/USB scanner text or pasted codes; phone camera is not implemented.

## Release gates
1. npm ci; npm run build; node --test tests/*.test.cjs.
2. Test Edge Function in staging: 401 without JWT, 403 for non-admin, 200 for Core owner/admin.
3. Validate QR scan repeatability, resolution, label orientation, quiet zone and paper size on the actual Core Innovations thermal printer.
4. Verify a sample available unit, damaged unit, and allocated unit. The exact token must remain unchanged across reprints.
5. Confirm Core/Nexus reservations, payments, recovery, and stock remain unchanged.
6. Obtain explicit owner approval before any production deployment.

## Limits
100 lots, 1000 units in list; 50 unit IDs per print batch. Overflow fails rather than silently undercounting.
If an unrelated production incident occurs, use docs/inventory-launch-runbook.md for owner-led reconciliation; do not autonomously rollback or restore paid units.

## November 6 verification improvements
- QR output uses a four-module quiet zone (matching the calibration sample).
- The Core-only endpoint emits Access-Control-Allow-Origin only for permitted Core and local development origins.
- Printing requests a fresh read-only snapshot; changed unit state/lot/ordinal/name blocks printing.
- Staging deployment is **not complete**: the production Supabase project has no development branches and no dedicated active Core staging project was confirmed. Do not substitute production for staging.
- The synthetic calibration PDF is separate from the repository and has no live scan tokens.

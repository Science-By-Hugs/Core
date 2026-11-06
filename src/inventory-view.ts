import { listInventoryLots, lookupInventoryToken, prepareInventoryLabels, type InventoryLot, type UnitLabel } from './services/inventory'

type Esc = (value: unknown) => string
const tally = (lot: InventoryLot, state: string) => lot.units.filter(u => u.state === state).length

function labelMarkup(item: UnitLabel, esc: Esc): string {
  const qr = item.qr_svg.replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
  const caution = item.state === 'available' ? 'FOR RESEARCH ONLY' : item.state.toUpperCase() + ' · NOT AVAILABLE'
  return '<article class="sbh-thermal-label"><div class="sbh-label-copy">' +
    '<div class="sbh-label-brand">SCIENCE BY HUGS</div>' +
    '<div class="sbh-label-product">' + esc(item.product_name) + '</div>' +
    '<div class="sbh-label-lot">LOT ' + esc(item.internal_lot) + '</div>' +
    '<div class="sbh-label-unit">UNIT ' + esc(String(item.ordinal).padStart(2, '0')) + '</div>' +
    '<div class="sbh-label-caution">' + esc(caution) + '</div>' +
    '</div><div class="sbh-label-qr">' + qr + '</div></article>'
}

const printCss =
  '@page { size: 2in 1in; margin: 0; }' +
  '* { box-sizing: border-box; }' +
  'html,body { margin:0; padding:0; background:#fff; color:#000; font-family:Arial,Helvetica,sans-serif; }' +
  '.sbh-thermal-label { width:2in; height:1in; padding:.055in; overflow:hidden; display:grid; grid-template-columns:1.12in .72in; gap:.045in; align-items:center; break-after:page; page-break-after:always; }' +
  '.sbh-label-copy { min-width:0; display:flex; flex-direction:column; justify-content:center; gap:.025in; }' +
  '.sbh-label-brand { font-size:7pt; font-weight:800; }' +
  '.sbh-label-product { font-size:8.3pt; font-weight:700; line-height:1.05; overflow-wrap:anywhere; }' +
  '.sbh-label-lot { font-size:6.2pt; font-weight:700; overflow-wrap:anywhere; }' +
  '.sbh-label-unit { font-size:6.4pt; font-weight:700; }' +
  '.sbh-label-caution { font-size:5.5pt; font-weight:700; }' +
  '.sbh-label-qr,.sbh-label-qr svg { width:.72in !important; height:.72in !important; display:block; }'

async function printPrepared(labels: UnitLabel[], esc: Esc): Promise<string | null> {
  // Open during the direct click; query current state before sending labels to the printer.
  const popup = window.open('', '_blank', 'width=640,height=500')
  if (!popup) return 'Allow Core popups to print labels.'
  popup.document.open()
  popup.document.write('<!doctype html><html><body>Checking current unit status before printing…</body></html>')
  popup.document.close()
  try {
    const current = await prepareInventoryLabels(labels.map(item => item.unit_id))
    const isCurrent = current.length === labels.length && current.every((item, index) => {
      const original = labels[index]
      return item.unit_id === original.unit_id &&
        item.state === original.state &&
        item.internal_lot === original.internal_lot &&
        item.ordinal === original.ordinal &&
        item.product_name === original.product_name
    })
    if (!isCurrent) {
      popup.close()
      return 'A unit changed since labels were prepared. Refresh inventory and try again.'
    }
    const documentHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Science By Hugs — 2x1 labels</title><style>' + printCss + '</style></head><body>' +
      current.map(item => labelMarkup(item, esc)).join('') +
      '<script>window.addEventListener("load",function(){window.focus();window.print()})<' + '/script>' +
      '</body></html>'
    popup.document.open()
    popup.document.write(documentHtml)
    popup.document.close()
    return null
  } catch {
    popup.close()
    return 'Could not recheck unit status. Printing was cancelled.'
  }
}

export function inventoryPageMarkup(email: string, esc: Esc): string {
  return '<section class="dashboard-head dashboard-head-compact"><div>' +
    '<span class="eyebrow">CORE · PHASE 2</span><h1 class="dashboard-title">Inventory</h1>' +
    '<p class="copy">Private unit tracking and 2×1-inch thermal labels. Viewing and printing never change stock.</p>' +
    '</div><div class="operator">Signed in as <strong>' + esc(email) + '</strong></div></section>' +
    '<section class="sbh-inventory" aria-label="Inventory dashboard">' +
    '<div class="sbh-inventory-tools"><button class="secondary compact" id="sbh-inventory-refresh" type="button">Refresh stock</button>' +
    '<label><span>Scan or paste a QR token</span><input id="sbh-inventory-scan" type="text" autocomplete="off" spellcheck="false" placeholder="SBH:UNIT:…" /></label>' +
    '<button class="secondary compact" id="sbh-inventory-find" type="button">Find unit</button></div>' +
    '<p id="sbh-inventory-lookup" role="status"></p>' +
    '<div id="sbh-inventory-lots"><div class="loading">Loading private inventory…</div></div>' +
    '<section id="sbh-inventory-preview" aria-live="polite"></section></section>'
}

function card(lot: InventoryLot, esc: Esc): string {
  const available = tally(lot, 'available')
  const damaged = tally(lot, 'damaged')
  const reserved = tally(lot, 'reserved')
  const allocated = tally(lot, 'allocated')
  const buttons = [
    available ? '<button class="secondary compact sbh-prepare-labels" type="button" data-state="available">Prepare ' + available + ' available labels</button>' : '',
    damaged ? '<button class="secondary compact sbh-prepare-labels" type="button" data-state="damaged">Prepare ' + damaged + ' damaged labels</button>' : '',
    allocated ? '<button class="secondary compact sbh-prepare-labels" type="button" data-state="allocated">Reprint ' + allocated + ' allocated labels</button>' : '',
  ].filter(Boolean).join('')
  return '<article class="sbh-inventory-lot" data-lot-id="' + esc(lot.id) + '">' +
    '<div class="sbh-inventory-lot-head"><div><span class="eyebrow">' + esc(lot.product_code || 'PRODUCT') + '</span>' +
    '<h2>' + esc(lot.product_name) + '</h2><p>Lot <strong>' + esc(lot.internal_lot) + '</strong> · Supplier lot ' + esc(lot.supplier_lot) + '</p></div>' +
    '<div class="sbh-inventory-counts">' +
    '<span><strong>' + available + '</strong>Available</span><span><strong>' + reserved + '</strong>Reserved</span>' +
    '<span><strong>' + allocated + '</strong>Allocated</span><span><strong>' + damaged + '</strong>Damaged</span></div></div>' +
    '<div class="sbh-inventory-actions">' + (buttons || 'No printable units currently in this lot.') + '</div>' +
    '<details class="sbh-inventory-units"><summary>View ' + lot.units.length + ' unit records</summary>' +
    '<div class="sbh-inventory-unit-table"><table><thead><tr><th>Unit</th><th>State</th><th>Scan token</th></tr></thead><tbody>' +
    lot.units.map(unit => '<tr><td>' + esc(String(unit.ordinal).padStart(2, '0')) + '</td><td>' +
      esc(unit.state) + '</td><td><code>' + esc(unit.scan_token) + '</code></td></tr>').join('') +
    '</tbody></table></div></details></article>'
}

export async function bindInventoryPage(esc: Esc): Promise<void> {
  const list = document.querySelector<HTMLElement>('#sbh-inventory-lots')
  const preview = document.querySelector<HTMLElement>('#sbh-inventory-preview')
  const status = document.querySelector<HTMLElement>('#sbh-inventory-lookup')
  if (!list || !preview || !status) return

  async function refresh(): Promise<void> {
    list!.innerHTML = '<div class="loading">Refreshing inventory…</div>'
    preview!.innerHTML = ''
    try {
      const lots = await listInventoryLots()
      if (!list!.isConnected) return
      list!.innerHTML = lots.length ? lots.map(lot => card(lot, esc)).join('') :
        '<div class="empty-state">No received physical inventory lots.</div>'
      list!.querySelectorAll<HTMLButtonElement>('.sbh-prepare-labels').forEach(button => {
        button.addEventListener('click', async () => {
          const lotId = button.closest<HTMLElement>('[data-lot-id]')?.dataset.lotId
          const lot = lots.find(l => l.id === lotId)
          const state = button.dataset.state || ''
          const ids = lot?.units.filter(u => u.state === state).map(u => u.id) || []
          if (!ids.length) return
          if (ids.length > 50) { status!.textContent = 'Prepare no more than 50 at a time.'; return }
          button.disabled = true
          preview!.innerHTML = '<div class="loading">Preparing secure QR codes…</div>'
          try {
            const labels = await prepareInventoryLabels(ids)
            if (!preview!.isConnected) return
            if (labels.some(label => label.state !== state)) {
              preview!.textContent = 'Unit states changed. Refresh inventory to prepare current labels.'
              return
            }
            preview!.innerHTML =
              '<div class="sbh-inventory-print-head"><h2>Labels ready: ' + labels.length + '</h2>' +
              '<p>Printer: 2×1 inches · landscape · actual size · no margins.</p>' +
              '<button class="primary" type="button" id="sbh-inventory-print">Print labels</button></div>' +
              '<div class="sbh-inventory-preview-grid">' + labels.map(label => labelMarkup(label, esc)).join('') + '</div>'
            preview!.querySelector<HTMLButtonElement>('#sbh-inventory-print')?.addEventListener('click', async event => {
              const control = event.currentTarget as HTMLButtonElement
              control.disabled = true
              try {
                const failure = await printPrepared(labels, esc)
                if (failure) status!.textContent = failure
              } finally {
                control.disabled = false
              }
            })
            preview!.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } catch (error) {
            preview!.textContent = error instanceof Error ? error.message : 'Could not prepare labels.'
          } finally { button.disabled = false }
        })
      })
    } catch (error) {
      list!.innerHTML = '<div class="empty-state error-state">' +
        esc(error instanceof Error ? error.message : 'Could not load inventory') + '</div>'
    }
  }

  document.querySelector<HTMLButtonElement>('#sbh-inventory-refresh')
    ?.addEventListener('click', () => { void refresh() })
  document.querySelector<HTMLButtonElement>('#sbh-inventory-find')
    ?.addEventListener('click', async () => {
      const token = document.querySelector<HTMLInputElement>('#sbh-inventory-scan')?.value.trim() || ''
      if (!token) { status.textContent = 'Scan or paste a QR token first.'; return }
      status.textContent = 'Looking up unit…'
      try {
        const u = await lookupInventoryToken(token)
        if (!status.isConnected) return
        status.innerHTML = '<strong>' + esc(u.product_name) + '</strong> · Lot ' + esc(u.internal_lot) +
          ' · Unit ' + esc(u.ordinal) + ' · State: <strong>' + esc(u.state) + '</strong>'
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Unit not found.'
      }
    })
  document.querySelector<HTMLInputElement>('#sbh-inventory-scan')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('#sbh-inventory-find')?.click()
      }
    })
  await refresh()
}

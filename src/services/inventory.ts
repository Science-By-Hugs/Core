import { supabase } from './supabase'

export type InventoryUnit = {
  id: string
  lot_id: string
  product_id: string
  ordinal: number
  scan_token: string
  state: string
}

export type InventoryLot = {
  id: string
  product_id: string
  product_name: string
  product_code: string | null
  internal_lot: string
  supplier_lot: string
  expiry_date: string | null
  accepted_units: number
  damaged_units: number
  units: InventoryUnit[]
}

export type UnitLabel = {
  unit_id: string
  product_code: string | null
  product_name: string
  internal_lot: string
  expiry_date: string | null
  ordinal: number
  state: string
  qr_svg: string
}

async function inventoryRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('core-inventory-labels', { body })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Inventory request unavailable')
  return data as T
}

export async function listInventoryLots(): Promise<InventoryLot[]> {
  const response = await inventoryRequest<{ success: true; lots: InventoryLot[] }>({ action: 'list' })
  return response.lots
}

export async function prepareInventoryLabels(unitIds: string[]): Promise<UnitLabel[]> {
  const response = await inventoryRequest<{ success: true; labels: UnitLabel[] }>({
    action: 'labels',
    unitIds,
  })
  return response.labels
}

export async function lookupInventoryToken(scanToken: string) {
  const response = await inventoryRequest<{ success: true; unit: {
    id: string; ordinal: number; state: string; product_name: string
    product_code: string | null; internal_lot: string; supplier_lot: string
    expiry_date: string | null
  } }>({ action: 'lookup', scanToken })
  return response.unit
}

// Shared reads and row -> API shape mappers. API shapes match gen ai/src/types.ts.
import type { ItemForAI, ProfileForAI } from "./ai/types.js"
import { QUOTA_MESSAGE } from "./ai/images.js"
import type { Tx } from "./db.js"
import type { Storage } from "./storage.js"

export type ItemRow = {
  id: string
  name: string
  category: ItemForAI["category"]
  subcategory: string | null
  color: string | null
  pattern: string | null
  material: string | null
  style: string | null
  season: string
  image_path: string
  cutout_path: string | null
  ai_attributes?: { studio_path?: string; box?: unknown } | null
  favorite: boolean
  wear_count: number
  worn_often?: boolean
  created_at: Date
}

export const itemImage = (i: Pick<ItemRow, "cutout_path" | "image_path">) => i.cutout_path ?? i.image_path

export async function wardrobeItems(tx: Tx, userId: string, category?: string) {
  return tx<ItemRow[]>`
    select * from wardrobe_items_view
    where user_id = ${userId} ${category ? tx`and category = ${category}` : tx``}
    order by created_at desc, name`
}

export const studioPath = (i: Pick<ItemRow, "ai_attributes">) => i.ai_attributes?.studio_path ?? null

export async function itemsToApi(storage: Storage, rows: ItemRow[]) {
  const urls = await storage.urls("wardrobe", [...rows.map(itemImage), ...rows.map(studioPath)])
  return rows.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    color: i.color ?? "",
    season: i.season,
    imageUrl: urls.get(itemImage(i)) ?? "",
    // "cutout": transparent PNG; "original": the photo as taken (kept on purpose); null: not cleaned up yet
    photo: !i.cutout_path ? null : i.cutout_path === i.image_path ? "original" : "cutout",
    // catalogue-style picture of the item (studio.ts); null until it's made or when images are off
    studioUrl: (studioPath(i) && urls.get(studioPath(i)!)) || null,
    wornOften: !!i.worn_often,
    // extras the Add/Edit screens can use
    subcategory: i.subcategory,
    pattern: i.pattern,
    material: i.material,
    style: i.style,
    favorite: i.favorite,
    wearCount: i.wear_count,
  }))
}

export function itemsForAI(rows: ItemRow[]): ItemForAI[] {
  return rows.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    color: i.color,
    material: i.material,
    pattern: i.pattern,
    style: i.style,
    season: i.season,
    wearCount: i.wear_count,
    favorite: i.favorite,
  }))
}

export type ProfileRow = {
  id: string
  name: string
  city: string | null
  avatar_path: string | null
  profile_completion: number
  style_dna: string | null
  style_tags: string[]
  body_profile: Record<string, unknown>
  style_prefs: Record<string, unknown>
}

export async function profile(tx: Tx, userId: string) {
  const [row] = await tx<ProfileRow[]>`select * from profiles where id = ${userId}`
  return row
}

export function profileForAI(p: ProfileRow): ProfileForAI {
  return {
    name: p.name,
    city: p.city,
    styleDna: p.style_dna,
    styleTags: p.style_tags,
    bodyProfile: p.body_profile,
    stylePrefs: p.style_prefs,
  }
}

export type LookRow = {
  id: string
  user_id: string
  occasion: string
  style: string
  location: string | null
  event_at: Date | null
  weather: { tempC: number; condition: string; advice: string } | null
  title: string | null
  reasoning: string | null
  tags: string[]
  style_match: number | null
  status: "pending" | "ready" | "failed"
  visualization_path: string | null
  visualization_status: "pending" | "ready" | "failed"
  error?: string | null
  saved_at: Date | null
  created_at: Date
}

export function pictureError(error: string | null | undefined) {
  if (error?.startsWith(QUOTA_MESSAGE)) return QUOTA_MESSAGE
  if (error === "image generation not configured") return "Pictures aren't set up on this server yet."
  // each picture service's reason, e.g. "deapi: HTTP 429 …; cloudflare: daily free quota used up"
  const reasons = error?.match(/^No image provider could draw this picture \((.*)\)$/s)?.[1]
  if (reasons) return `The picture couldn't be made. ${reasons.length > 280 ? `${reasons.slice(0, 280)}…` : reasons}`
  return "The picture couldn't be made this time. Try again in a little while."
}

export function timeOfDay(d: Date | null, timeZone = "Asia/Kolkata") {
  if (!d) return "Today"
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(d))
  if (hour < 5) return "Night"
  if (hour < 12) return "Morning"
  if (hour < 17) return "Afternoon"
  if (hour < 21) return "Evening"
  return "Night"
}

export async function lookToApi(tx: Tx, storage: Storage, look: LookRow) {
  const items = await tx<(ItemRow & { position: number })[]>`
    select wi.*, li.position from look_items li
    join wardrobe_items wi on wi.id = li.wardrobe_item_id
    where li.look_id = ${look.id} order by li.position`
  const itemUrls = await storage.urls("wardrobe", [...items.map(itemImage), ...items.map(studioPath)])
  const vizUrls = await storage.urls("looks", [look.visualization_path])
  const firstItemImage = items[0] ? itemUrls.get(itemImage(items[0])) : undefined
  return {
    id: look.id,
    title: look.title ?? "",
    // until the image model finishes (or if none is configured) show the first item's photo
    visualizationUrl: (look.visualization_path && vizUrls.get(look.visualization_path)) || firstItemImage || "",
    hasPicture: !!look.visualization_path,
    timeOfDay: timeOfDay(look.event_at),
    tempC: look.weather?.tempC ?? null,
    styleMatch: look.style_match ?? 0,
    reasoning: look.reasoning ?? "",
    tags: look.tags,
    items: items.map((i) => ({
      wardrobeItemId: i.id,
      name: i.name,
      meta: [i.category, i.material].filter(Boolean).join(" · "),
      imageUrl: itemUrls.get(itemImage(i)) ?? "",
      // for the web app's model view, which layers the cutouts by category
      category: i.category,
      photo: !i.cutout_path ? null : i.cutout_path === i.image_path ? "original" : "cutout",
      studioUrl: (studioPath(i) && itemUrls.get(studioPath(i)!)) || null,
    })),
    // extras
    status: look.status,
    visualizationStatus: look.visualization_status,
    // why there's no picture, in words for the user
    visualizationError: look.visualization_status === "failed" ? pictureError(look.error) : null,
    saved: !!look.saved_at,
    occasion: look.occasion,
    style: look.style,
    location: look.location,
    eventAt: look.event_at,
    weather: look.weather,
  }
}

export function formatPrice(amount: number | null, currency: string) {
  if (amount == null) return ""
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)
}

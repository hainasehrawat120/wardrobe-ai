// Image generation: look try-ons, recommendation, shopping and trend pictures. Providers are tried
// in order and the first picture wins; when none answers, callers fall back to the clothing photos
// (the web app then shows its own model built from the cutouts).
//  1. Gemini image model (GEMINI_IMAGE_MODEL, off by default): dresses the person in the actual
//     pieces and can use the face photo. Only free if Google offers a free quota for that model on
//     your key; a key with no billing account is never charged.
//  2. Replicate (REPLICATE_API_TOKEN): PAID, off unless a token is set.
//  3. Cloudflare Workers AI (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN), free plan, no card,
//     10,000 neurons a day (a few hundred pictures); when they're used up it errors, it never bills.
//     With reference photos (the user's clothes, face) it uses FLUX.2 klein, which edits from them,
//     so pictures show the actual garment; text-only prompts use FLUX.1 schnell.
//  4. Pollinations (FREE_IMAGES=pollinations): keyless, but now asks for payment after one image.
// Background removal for wardrobe photos runs in the browser (frontend/src/lib/cutout.ts); the
// Replicate remover here is only used when a token is set.
import { GoogleGenAI, type Part } from "@google/genai"
import sharp from "sharp"
import type { ImageAI, ImageBytes, TryOnRequest } from "./types.js"

type Provider = {
  name: string
  /** false: skip this provider for that picture (e.g. a paid one kept for try-ons) */
  accepts?(req: TryOnRequest): boolean
  generate(req: TryOnRequest): Promise<ImageBytes>
}

/** The free plan's daily picture quota is used up: nothing more can be drawn until it resets */
export class QuotaError extends Error {}
export const QUOTA_MESSAGE = "Today's free picture quota is used up. It resets at 00:00 UTC (5:30 AM in India)."

export type ImageOptions = {
  replicateToken?: string
  replicateImageModel: string
  replicateBgModel: string
  geminiKey?: string
  geminiImageModel?: string
  /** "tryons": the Gemini image model only draws "see it on you" pictures; "all": every picture */
  geminiImageUse?: "tryons" | "all"
  cloudflare?: CloudflareOptions
  deapi?: DeapiOptions
  freeImages: "pollinations" | "none"
  pollinationsUrl: string
  fetch?: typeof fetch
}

export function createImageAI(opts: ImageOptions): ImageAI {
  const http = opts.fetch ?? fetch
  const providers: Provider[] = []
  if (opts.geminiKey && opts.geminiImageModel) providers.push(gemini(opts.geminiKey, opts.geminiImageModel, opts.geminiImageUse ?? "tryons"))
  const replicate = opts.replicateToken ? replicateRunner(opts.replicateToken, http) : null
  if (replicate) {
    providers.push({
      name: "replicate",
      generate: (req) =>
        replicate(opts.replicateImageModel, { prompt: req.prompt, aspect_ratio: "3:4", output_format: "webp" }),
    })
  }
  // before Cloudflare: same FLUX.2 klein model, but it takes the reference photos at full detail
  if (opts.deapi) providers.push(deapi(opts.deapi, http))
  if (opts.cloudflare) providers.push(cloudflare(opts.cloudflare, http))
  if (opts.freeImages === "pollinations") providers.push(pollinations(opts.pollinationsUrl, http))

  return {
    enabled: providers.length > 0,
    usesReferences: !!((opts.geminiKey && opts.geminiImageModel) || opts.cloudflare || opts.deapi),
    async generate(req) {
      const errors: { name: string; err: Error }[] = []
      for (const p of providers) {
        if (p.accepts && !p.accepts(req)) continue
        try {
          return await p.generate(req)
        } catch (err) {
          console.warn(`[images] ${p.name} failed: ${(err as Error).message}`)
          errors.push({ name: p.name.split(" ")[0], err: err as Error })
        }
      }
      if (!providers.length) return null
      // the quota message only when every service tried is out of quota; otherwise each one's reason,
      // so the look (and the app) can say why there is no picture
      if (errors.length && errors.every((e) => e.err instanceof QuotaError)) throw new QuotaError(QUOTA_MESSAGE)
      const why = errors.map((e) => `${e.name}: ${e.err instanceof QuotaError ? "daily free quota used up" : e.err.message}`)
      throw new Error(`No image provider could draw this picture (${why.join("; ") || "none was available"})`)
    },
    removeBackground: async (imageUrl) => (replicate ? replicate(opts.replicateBgModel, { image: imageUrl }) : null),
  }
}

// Gemini's picture shapes, for the requested width/height
const ASPECTS = [["1:1", 1], ["2:3", 2 / 3], ["3:2", 3 / 2], ["3:4", 3 / 4], ["4:3", 4 / 3], ["9:16", 9 / 16], ["16:9", 16 / 9]] as const
export function aspectRatio(width: number, height: number) {
  const r = width / height
  return ASPECTS.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0]
}

// A try-on: the person wearing the user's own pieces (not a studio photo or a text-only picture)
const isTryOn = (req: TryOnRequest) => req.mode !== "studio" && !!(req.garments?.length || req.face)

function gemini(apiKey: string, model: string, use: "tryons" | "all"): Provider {
  const client = new GoogleGenAI({ apiKey })
  return {
    name: `gemini ${model}`,
    // paid per picture: by default spent where it makes the biggest difference
    accepts: (req) => use === "all" || isTryOn(req),
    async generate(req) {
      const parts: Part[] = []
      for (const g of req.garments ?? []) parts.push({ inlineData: { data: base64(g.bytes), mimeType: g.contentType } })
      if (req.face) parts.push({ inlineData: { data: base64(req.face.bytes), mimeType: req.face.contentType } })
      parts.push({ text: `${req.prompt} ${referenceNote(req)}`.trim() })
      const res = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["IMAGE", "TEXT"],
          ...(req.width && req.height ? { imageConfig: { aspectRatio: aspectRatio(req.width, req.height), imageSize: "1K" } } : {}),
        },
      })
      const img = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
      if (!img?.data) throw new Error(`no image returned (${res.candidates?.[0]?.finishReason ?? "blocked"})`)
      return { bytes: Buffer.from(img.data, "base64"), contentType: img.mimeType ?? "image/png" }
    },
  }
}

/** Tells an image model what each reference photo is (images numbered from 0) */
export function referenceNote(req: TryOnRequest) {
  if (req.mode === "studio") return ""
  const n = req.garments?.length ?? 0
  // with labels, each photo is named so the model knows which piece goes where (top over bottoms...)
  const which = req.labels?.length
    ? req.garments!.map((_, i) => `Image ${i} is the user's ${req.labels![i] ?? "garment"}.`).join(" ")
    : `${n === 1 ? "Image 0 is" : `Images 0 to ${n - 1} are`} the user's own clothes.`
  return [
    n ? `${which} Dress the person in exactly ${n === 1 ? "this piece" : "all of these pieces together, every one clearly visible"}, keeping their colours, wash, prints, details and cut.` : "",
    // models copy everything in a reference photo: shop tags, hangers, even a back pocket onto the front
    n ? "Copy only the garments themselves, worn the right way round: leave out hangers, price tags, labels, mannequins and the photos' backgrounds, and keep back details such as back pockets at the back." : "",
    req.face ? `Image ${n} is the person's face: the person must look like them.` : "",
  ].join(" ").trim()
}

type CloudflareOptions = {
  accountId: string
  token: string
  /** text-only pictures */
  model: string
  /** edits from reference photos (studio photos, and try-ons unless tryOnModel is set) */
  editModel: string
  /** optional better model for try-ons; falls back to editModel when it fails (e.g. daily quota used up) */
  tryOnModel?: string
}

function cloudflare(cf: CloudflareOptions, http: typeof fetch): Provider {
  let queue: Promise<unknown> = Promise.resolve()
  // the free plan's 10,000 neurons a day are shared by every model and reset at 00:00 UTC
  let quotaUntil = 0
  const url = (model: string) => `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/run/${model}`
  const once = async (req: TryOnRequest, editModel: string) => {
    if (Date.now() < quotaUntil) throw new QuotaError(QUOTA_MESSAGE)
    // FLUX.2 klein takes up to 4 reference photos; the face goes last
    const refs = [...(req.garments ?? []).slice(0, req.face ? 3 : 4), ...(req.face ? [req.face] : [])]
    let res: Response
    if (refs.length) {
      const form = new FormData()
      form.append("prompt", `${req.prompt} ${referenceNote({ ...req, garments: refs.slice(0, req.face ? -1 : undefined) })}`.trim().slice(0, 2000))
      // Workers AI rejects FLUX.2 reference photos of 512x512 or more, so phone photos are shrunk first
      const small = await Promise.all(refs.map((r) => fitReference(r)))
      small.forEach((r, i) => form.append(`input_image_${i}`, new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.contentType }), `ref${i}`))
      form.append("width", String(req.width ?? 768))
      form.append("height", String(req.height ?? 1024))
      res = await http(url(editModel), { method: "POST", headers: { Authorization: `Bearer ${cf.token}` }, body: form, signal: AbortSignal.timeout(120_000) })
    } else {
      res = await http(url(cf.model), {
        method: "POST",
        headers: { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: req.prompt.slice(0, 2000), steps: 8, seed: Math.floor(Math.random() * 1e9) }),
        signal: AbortSignal.timeout(90_000),
      })
    }
    const body = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { code?: number; message?: string }[] } | null
    const image = body?.result?.image
    if (!res.ok || !image) {
      const message = `HTTP ${res.status} ${body?.errors?.map((e) => e.message).join("; ") ?? ""}`
      // 4006: "you have used up your daily free allocation of 10,000 neurons"; nothing else counts
      if (body?.errors?.some((e) => e.code === 4006 || /daily free allocation/i.test(e.message ?? ""))) {
        quotaUntil = new Date().setUTCHours(24, 0, 0, 0)
        console.warn(`[images] cloudflare: daily free quota used up until ${new Date(quotaUntil).toISOString()} (${message})`)
        throw new QuotaError(QUOTA_MESSAGE)
      }
      throw new Error(message)
    }
    const bytes = new Uint8Array(Buffer.from(image, "base64"))
    return { bytes, contentType: bytes[0] === 0x89 ? "image/png" : "image/jpeg" }
  }
  return {
    name: "cloudflare",
    // one at a time keeps a burst (a new wardrobe) inside the free plan's rate limit
    generate(req) {
      // redraws use the standard model: the better one costs about 8x more of the daily quota
      const tryOn = !!cf.tryOnModel && req.mode !== "studio" && !req.redraw && !!(req.garments?.length || req.face)
      const run = queue.then(() =>
        tryOn
          ? once(req, cf.tryOnModel!).catch((err: Error) => {
              // both models share the quota, so the fallback would fail too
              if (err instanceof QuotaError) throw err
              console.warn(`[images] cloudflare ${cf.tryOnModel} failed, using ${cf.editModel}: ${err.message}`)
              return once(req, cf.editModel)
            })
          : once(req, cf.editModel),
      )
      queue = run.catch(() => undefined)
      return run
    },
  }
}

type DeapiOptions = {
  token: string
  /** an image-edit model taking several reference photos, e.g. Flux_2_Klein_4B_BF16 */
  model: string
  /** "tryons": only "see it on you" pictures; "all": studio photos too */
  use: "tryons" | "all"
  /** wait between job status checks (tests set it low) */
  pollMs?: number
}

// deAPI (deapi.ai): pay per picture from prepaid credit ($5 free on sign-up), about $0.007 a try-on.
// Same FLUX.2 klein 4B as Cloudflare, but without its 512px limit on the reference photos, so prints
// and details come through. Jobs are queued: start one, then poll until it's done.
function deapi(opts: DeapiOptions, http: typeof fetch): Provider {
  const api = "https://api.deapi.ai/api/v2"
  const auth = { Authorization: `Bearer ${opts.token}`, Accept: "application/json" }
  // out of credit or refused: don't call it for a while instead of slowing every picture down
  let pausedUntil = 0
  let pausedFor = ""
  const pause = (why: string) => {
    pausedUntil = Date.now() + 60 * 60 * 1000
    pausedFor = why
    console.warn(`[images] deapi paused for an hour: ${why}`)
  }
  const size = (n: number | undefined, fallback: number) => Math.min(1536, Math.max(256, Math.round((n ?? fallback) / 16) * 16))
  return {
    name: `deapi ${opts.model}`,
    accepts: (req) => (opts.use === "all" ? !!(req.garments?.length || req.face) : isTryOn(req)),
    async generate(req) {
      // fails straight away, but with its reason, so a missing picture can be explained
      if (Date.now() < pausedUntil) throw new Error(`paused for an hour after: ${pausedFor}`)
      // up to 3 reference photos; the face goes last
      const refs = [...(req.garments ?? []).slice(0, req.face ? 2 : 3), ...(req.face ? [req.face] : [])]
      const form = new FormData()
      form.append("prompt", `${req.prompt} ${referenceNote({ ...req, garments: refs.slice(0, req.face ? -1 : undefined) })}`.trim())
      form.append("model", opts.model)
      form.append("seed", String(Math.floor(Math.random() * 1e9)))
      form.append("width", String(size(req.width, 768)))
      form.append("height", String(size(req.height, 1024)))
      form.append("steps", "4")
      const small = await Promise.all(refs.map((r) => shrinkImage(r, 1024)))
      small.forEach((r, i) => form.append("images[]", new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.contentType }), `ref${i}`))

      const start = await http(`${api}/images/edits`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(60_000) })
      const started = (await start.json().catch(() => null)) as { data?: { request_id?: string }; message?: string } | null
      const id = started?.data?.request_id
      if (!start.ok || !id) {
        const why = `HTTP ${start.status} ${started?.message ?? ""}`.trim()
        // 401/402/403: bad key, no credit left or not allowed; 429: rate limited for the day
        if ([401, 402, 403].includes(start.status) || /credit|balance|insufficient/i.test(why)) pause(why)
        throw new Error(why)
      }
      type Job = { status?: string; result_url?: string; error_reason?: string; error_code?: string }
      for (const until = Date.now() + 150_000; Date.now() < until; ) {
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000))
        const res = await http(`${api}/jobs/${id}`, { headers: auth, signal: AbortSignal.timeout(30_000) })
        const job = ((await res.json().catch(() => null)) as { data?: Job } | null)?.data
        if (job?.status === "done" && job.result_url) {
          const file = await http(job.result_url, { signal: AbortSignal.timeout(60_000) })
          if (!file.ok) throw new Error(`deapi result download failed: ${file.status}`)
          return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.headers.get("content-type") ?? "image/png" }
        }
        if (job?.status === "error" || job?.status === "failed") throw new Error(`deapi job failed: ${job.error_reason ?? job.error_code ?? "unknown"}`)
      }
      throw new Error("deapi job took too long")
    },
  }
}

// Free, keyless text-to-image. One request at a time: anonymous use is rate limited per IP.
function pollinations(baseUrl: string, http: typeof fetch): Provider {
  let queue: Promise<unknown> = Promise.resolve()
  const once = async (prompt: string) => {
    const url = new URL(`${baseUrl.replace(/\/?$/, "/")}${encodeURIComponent(prompt.slice(0, 1500))}`)
    url.search = new URLSearchParams({
      width: "768",
      height: "1024",
      model: "flux",
      nologo: "true",
      private: "true",
      seed: String(Math.floor(Math.random() * 1e9)),
      referrer: "wardrobe-ai",
    }).toString()
    const res = await http(url, { signal: AbortSignal.timeout(120_000) })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`)
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: type }
  }
  return {
    name: "pollinations",
    generate(req) {
      const run = queue.then(() => once(req.prompt))
      queue = run.catch(() => undefined)
      return run
    },
  }
}

function replicateRunner(token: string, http: typeof fetch) {
  return async function run(model: string, input: Record<string, unknown>): Promise<ImageBytes> {
    const res = await http(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify({ input }),
    })
    let prediction = await res.json()
    if (!res.ok) throw new Error(`Replicate ${model}: ${res.status} ${prediction?.detail ?? ""}`)
    // Prefer: wait returns early for slow models; poll until done
    for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(prediction.status); i++) {
      await new Promise((r) => setTimeout(r, 2000))
      prediction = await (await http(prediction.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json()
    }
    if (prediction.status !== "succeeded") throw new Error(`Replicate ${model}: ${prediction.status} ${prediction.error ?? ""}`)
    const url: string = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
    const file = await http(url)
    if (!file.ok) throw new Error(`Replicate output download failed: ${file.status}`)
    return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.headers.get("content-type") ?? "image/webp" }
  }
}

const base64 = (b: Uint8Array) => Buffer.from(b).toString("base64")

// "All input images must be smaller than 512x512" (Cloudflare's FLUX.2 docs)
export const MAX_REFERENCE_SIDE = 504

/** Shrinks a reference photo to fit inside MAX_REFERENCE_SIDE; cutouts keep their transparency */
export const fitReference = (img: ImageBytes) => shrinkImage(img, MAX_REFERENCE_SIDE)

/** Shrinks a picture to fit inside `max` pixels a side; pictures with transparency stay PNG */
export async function shrinkImage(img: ImageBytes, max: number): Promise<ImageBytes> {
  try {
    const pic = sharp(img.bytes).rotate()
    const meta = await pic.metadata()
    if (meta.width && meta.height && Math.max(meta.width, meta.height) <= max) return img
    const resized = pic.resize(max, max, { fit: "inside", withoutEnlargement: true })
    return meta.hasAlpha
      ? { bytes: new Uint8Array(await resized.png().toBuffer()), contentType: "image/png" }
      : { bytes: new Uint8Array(await resized.jpeg({ quality: 90 }).toBuffer()), contentType: "image/jpeg" }
  } catch {
    // not a picture sharp can read: send it as it is and let the provider decide
    return img
  }
}

/** Framing for the stylist's one-line picture prompts (recommendations, shopping, trends) */
export const editorial = (prompt: string) => `Editorial fashion photo, full body, natural light, plain city background. ${prompt}`

import { getStudioSnapshot, putStudioSnapshot } from './studioBridge.js'
// IndexedDB-backed canvas persistence.
//
// Replaces the Vite dev-server middleware that previously stored the tldraw
// snapshot, selection, and view state on the host filesystem. Everything now
// lives in the browser so the app runs as a standalone static site with no
// backend. Cross-tab live refresh uses a BroadcastChannel instead of SSE.
//
// Design notes:
//  - A single merged canvas snapshot is stored under the "canvas" key. The old
//    per-page file split existed to give the Codex MCP server file-level
//    access; a browser-only, single-user app does not need it.
//  - Image assets are stored inline as data URLs inside the snapshot so the
//    JSON is fully self-contained (no separate blob store, no object-URL
//    lifecycle to manage). blob: URLs from drag-and-drop are captured into
//    data URLs on save.

import {
  isCanvasSnapshot,
  sanitizeCanvasSnapshotForTldraw
} from '../canvasSnapshot.js'

const DB_NAME = 'cowart'
const DB_VERSION = 1
const KV_STORE = 'kv'
const CANVAS_CHANNEL = 'cowart-canvas'
const KEY_CANVAS = 'canvas'
const KEY_SELECTION = 'selection'
const KEY_VIEW_STATE = 'viewState'
const KEY_SETTINGS = 'settings'

const DEFAULT_VIEW_STATE = {
  version: 1,
  currentPageId: null,
  camera: { x: 0, y: 0, z: 1 },
  updatedAt: null
}

const EMPTY_SELECTION = { selectedShapes: [], updatedAt: null }

let dbPromise = null
let canvasChannel = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function kvGet(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readonly')
    const request = tx.objectStore(KV_STORE).get(key)
    request.onsuccess = () => resolve(request.result ? request.result.value : null)
    request.onerror = () => reject(request.error)
  })
}

async function kvSet(key, value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite')
    tx.objectStore(KV_STORE).put({ key, value })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Capture blob: asset sources (e.g. from drag-and-drop uploads) into stable
// data URLs so the persisted snapshot is self-contained. Remote http(s) URLs
// and existing data URLs are left untouched.
async function normalizeAssetSources(snapshot) {
  const store = snapshot.store
  for (const id of Object.keys(store)) {
    const record = store[id]
    if (record?.typeName !== 'asset' || record.type !== 'image') continue
    const src = record.props?.src
    if (typeof src !== 'string' || !src.startsWith('blob:')) continue
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      record.props.src = await blobToDataUrl(blob)
    } catch (error) {
      // A revoked blob URL cannot be recovered; warn but keep going so the
      // rest of the snapshot still saves.
      console.warn('Cowart could not capture asset blob, skipping:', src, error)
    }
  }
  return snapshot
}


let serverRevision = 0
let sessionSelection = { selectedShapes: [], updatedAt: null }
let sessionViewState = { version: 1, currentPageId: null, camera: { x: 0, y: 0, z: 1 }, updatedAt: null }

// All real canvas data is saved per account + project on Studio, never under a shared browser DB.
export async function loadCanvasSnapshot() {
  const response = await getStudioSnapshot()
  serverRevision = response.revision || 0
  return { snapshot: response.snapshot, storage: response.snapshot ? 'studio' : 'empty' }
}

export async function saveCanvasSnapshot(snapshot) {
  if (!isCanvasSnapshot(snapshot)) return { storage: 'invalid', skippedRecords: [] }
  const normalized = await normalizeAssetSources(snapshot)
  const sanitized = sanitizeCanvasSnapshotForTldraw(normalized)
  if (!sanitized.snapshot) return { storage: 'invalid', skippedRecords: sanitized.skippedRecords }
  const response = await putStudioSnapshot(sanitized.snapshot, serverRevision)
  serverRevision = response.revision
  return { storage: 'studio', skippedRecords: sanitized.skippedRecords }
}

export async function readSelection() {
  return { selection: sessionSelection }
}
export async function writeSelection(selection) {
  sessionSelection = selection
  return { ok: true }
}
export async function readViewState() {
  return { viewState: sessionViewState }
}
export async function writeViewState(viewState) {
  sessionViewState = viewState
  return { ok: true }
}

// Browser BYOK is intentionally disabled; account keys must remain on Studio backend.
export async function readSettings() {
  return { providers: [], image: { activeProviderId: null, activeModelId: null }, orchestrator: { activeProviderId: null, activeModelId: null } }
}
export async function writeSettings() {
  throw new Error('请通过 Studio 的中转站管理设置模型；Cowart 不在浏览器保存密钥')
}

function emptySettings() {
  return {
    providers: [],
    image: { activeProviderId: null, activeModelId: null },
    orchestrator: { activeProviderId: null, activeModelId: null }
  }
}

// Detect and upgrade legacy flat structures into the hierarchical shape.
// - v2 flat: { image:{providerId,config}, orchestrator:{providerId,config} }
//   → synthesize one provider per domain from each config + a single model.
// - v1 flat: { providerId, perProvider:{...} }
//   → synthesize from perProvider[providerId].
function migrateSettings(stored) {
  if (!stored || typeof stored !== 'object') return emptySettings()
  // Already the new hierarchical shape.
  if (Array.isArray(stored.providers)) {
    return {
      providers: stored.providers,
      image: stored.image ?? { activeProviderId: null, activeModelId: null },
      orchestrator: stored.orchestrator ?? { activeProviderId: null, activeModelId: null }
    }
  }

  const settings = emptySettings()
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`

  // v2 flat: per-domain providerId + config.
  if (stored.image?.config || stored.orchestrator?.config) {
    for (const [domain, block] of Object.entries(stored)) {
      if (!block?.config) continue
      const providerId = uid('pv')
      const modelId = uid('md')
      settings.providers.push({
        id: providerId,
        label: domain === 'image' ? '图像模型' : 'LLM 编排',
        presetId: block.providerId || null,
        kind: domain,
        endpoint: block.config.endpoint || '',
        apiKey: block.config.apiKey || '',
        proxyUrl: block.config.proxyUrl || '',
        models: [{ id: modelId, name: block.config.model || '', alias: '默认' }]
      })
      settings[domain] = { activeProviderId: providerId, activeModelId: modelId }
    }
    return settings
  }

  // v1 flat: single providerId + perProvider map.
  if (stored.providerId && stored.perProvider) {
    const cfg = stored.perProvider[stored.providerId] || {}
    const providerId = uid('pv')
    const modelId = uid('md')
    settings.providers.push({
      id: providerId,
      label: '默认图像模型',
      presetId: stored.providerId,
      kind: 'image',
      endpoint: cfg.baseUrl || cfg.endpoint || '',
      apiKey: cfg.apiKey || '',
      proxyUrl: cfg.proxyUrl || '',
      models: [{ id: modelId, name: cfg.model || '', alias: '默认' }]
    })
    settings.image = { activeProviderId: providerId, activeModelId: modelId }
    return settings
  }

  return emptySettings()
}

function getCanvasChannel() {
  if (canvasChannel) return canvasChannel
  if (typeof BroadcastChannel === 'undefined') return null
  canvasChannel = new BroadcastChannel(CANVAS_CHANNEL)
  return canvasChannel
}

export function broadcastCanvasChange(info) {
  const channel = getCanvasChannel()
  if (!channel) return
  channel.postMessage({ type: 'canvas-changed', ...info, at: Date.now() })
}

export function subscribeCanvasChanges(callback) {
  // Cross-tab remote merges are disabled until conflict resolution is implemented.
  return () => {}
  const channel = getCanvasChannel()
  if (!channel) return () => {}
  const handler = (event) => {
    if (event.data?.type === 'canvas-changed') callback(event.data)
  }
  channel.addEventListener('message', handler)
  return () => channel.removeEventListener('message', handler)
}

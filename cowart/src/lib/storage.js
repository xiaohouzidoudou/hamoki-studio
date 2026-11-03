import { normalizeAssetSources } from './assetCapture.js'
import { getStudioSnapshot, putStudioSnapshot, getStudioContext } from './studioBridge.js'
import { acknowledgeSavedResult } from './jobRecovery.js'
import { uploadCanvasAssets } from './canvasAssets.js'
// Account/project snapshots are persisted on Studio. IndexedDB holds view state only.

import {
  isCanvasSnapshot,
  sanitizeCanvasSnapshot
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

let serverRevision = 0
let sessionSelection = { selectedShapes: [], updatedAt: null }
let sessionViewState = { version: 1, currentPageId: null, camera: { x: 0, y: 0, z: 1 }, updatedAt: null }

// All real canvas data is saved per account + project on Studio, never under a shared browser DB.
export async function loadCanvasSnapshot() {
  const response = await getStudioSnapshot()
  serverRevision = response.revision || 0
  const { projectId } = await getStudioContext()
  acknowledgeSavedResult(projectId, response.snapshot)
  return { snapshot: response.snapshot, storage: response.snapshot ? 'studio' : 'empty' }
}

export async function saveCanvasSnapshot(snapshot) {
  if (!isCanvasSnapshot(snapshot)) return { storage: 'invalid', skippedRecords: [] }
  const uploaded = await uploadCanvasAssets(snapshot)
  const normalized = await normalizeAssetSources(uploaded.snapshot)
  const sanitized = sanitizeCanvasSnapshot(normalized)
  if (!sanitized.snapshot) return { storage: 'invalid', skippedRecords: sanitized.skippedRecords }
  const response = await putStudioSnapshot(sanitized.snapshot, serverRevision)
  serverRevision = response.revision
  const { projectId } = await getStudioContext()
  acknowledgeSavedResult(projectId, sanitized.snapshot)
  return { storage: 'studio', skippedRecords: sanitized.skippedRecords, assetReplacements: uploaded.replacements }
}

export async function readSelection() {
  return { selection: sessionSelection }
}
export async function writeSelection(selection) {
  sessionSelection = selection
  return { ok: true }
}
export async function readViewState() {
  const { projectId } = await getStudioContext()
  return { viewState: (await kvGet('viewState:' + projectId)) || sessionViewState }
}
export async function writeViewState(viewState) {
  const { projectId } = await getStudioContext()
  sessionViewState = viewState
  await kvSet('viewState:' + projectId, viewState)
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

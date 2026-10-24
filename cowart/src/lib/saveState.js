// A successful request acknowledges only the document version it captured.
export function createSaveState() {
  let version = 0
  let savedVersion = 0
  return {
    get dirty() { return version !== savedVersion },
    changed() { version += 1 },
    capture() { return version },
    acknowledge(capturedVersion) { savedVersion = Math.max(savedVersion, capturedVersion) }
  }
}

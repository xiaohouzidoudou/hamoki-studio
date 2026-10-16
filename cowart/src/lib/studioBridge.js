// Same-origin bridge to the existing Hamoki Studio account gateway.
// Credentials remain on the server; this module never reads provider API keys.
let projectPromise = null
export async function studioJSON(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options })
  let result
  try { result = await response.json() } catch { result = {} }
  if (!response.ok) {
    const error = new Error(result.error || 'Studio API ' + response.status)
    error.status = response.status
    throw error
  }
  return result
}

export async function getStudioContext() {
  if (!projectPromise) {
    projectPromise = studioJSON('/api/projects').then(({ projects, defaultId }) => {
      const requested = new URLSearchParams(location.search).get('projectId')
      const current = projects.find((p) => p.id === requested) ||
        projects.find((p) => p.id === defaultId) || projects[0]
      if (!current) throw new Error('当前账号暂无项目，请先从 Studio 创建一个')
      return { project: current, projects, projectId: current.id }
    }).catch((error) => { projectPromise = null; throw error })
  }
  return projectPromise
}

export async function putStudioSnapshot(snapshot, revision) {
  const context = await getStudioContext()
  return studioJSON('/api/cowart/snapshot?projectId=' + encodeURIComponent(context.projectId), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot, revision })
  })
}

export async function getStudioSnapshot() {
  const { projectId } = await getStudioContext()
  return studioJSON('/api/cowart/snapshot?projectId=' + encodeURIComponent(projectId))
}

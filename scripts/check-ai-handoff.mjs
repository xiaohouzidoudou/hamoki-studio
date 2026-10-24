import { readFileSync, existsSync } from 'node:fs'

const required = [
  ['AGENTS.md', ['Codex', 'ChatGPT', 'production']],
  ['docs/AI_COLLABORATION.md', ['Issue', 'CI', 'SHA']],
  ['docs/DEV_STATUS.md', ['Snapshot', 'QA', 'CI']],
  ['docs/DEV_TASKS.md', ['COW-QA-01', 'COW-E2E-03']],
  ['.github/PULL_REQUEST_TEMPLATE.md', ['Verification', 'QA']]
]
let errors = 0
for (const [filename, fragments] of required) {
  if (!existsSync(filename)) {
    console.error('Missing handoff file:', filename)
    errors++
    continue
  }
  const content = readFileSync(filename, 'utf8')
  for (const fragment of fragments) {
    if (!content.toLowerCase().includes(fragment.toLowerCase())) {
      console.error('Missing expected handoff topic:', filename, fragment)
      errors++
    }
  }
}
if (errors) process.exit(1)
console.log('AI collaboration handoff documents: OK')

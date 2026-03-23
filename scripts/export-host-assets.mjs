import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

function parseArgs(argv) {
  const args = argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--target") {
      return args[index + 1]
    }
  }

  return process.env.EVERRELAY_HOST_ASSETS_TARGET
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const targetArg = parseArgs(process.argv)

if (!targetArg) {
  console.error(
    "Missing host asset target. Run `pnpm export:host-assets -- --target /absolute/path/to/fronted/public/third-party-apps`."
  )
  process.exit(1)
}

const targetRoot = resolve(repoRoot, targetArg)
const demoWeatherSource = resolve(repoRoot, "examples/demo-weather-react/dist")
const demoWeatherTarget = resolve(targetRoot, "demo-weather")
const testMcpSource = resolve(repoRoot, "host-pages/test-mcp-afs/index.html")
const testMcpTarget = resolve(targetRoot, "test-mcp-afs/index.html")

if (!existsSync(demoWeatherSource)) {
  console.error(
    "Missing examples/demo-weather-react/dist. Run `pnpm build:demo-weather` before exporting host assets."
  )
  process.exit(1)
}

if (!existsSync(testMcpSource)) {
  console.error("Missing host-pages/test-mcp-afs/index.html.")
  process.exit(1)
}

mkdirSync(targetRoot, { recursive: true })
rmSync(demoWeatherTarget, { recursive: true, force: true })
mkdirSync(dirname(testMcpTarget), { recursive: true })
cpSync(demoWeatherSource, demoWeatherTarget, { recursive: true })
copyFileSync(testMcpSource, testMcpTarget)

console.log(`Exported host assets to ${targetRoot}`)

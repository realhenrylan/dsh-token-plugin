#!/usr/bin/env node
/**
 * release-local.mjs — 一条命令完成「升版本 + 测试 + 打包」。
 *
 *   npm run release -- patch       # 2.1.0 -> 2.1.1
 *   npm run release -- minor       # 2.1.0 -> 2.2.0
 *   npm run release -- major       # 2.1.0 -> 3.0.0
 *   npm run release -- 2.2.0       # 指定具体版本
 *   npm run release -- patch --dry-run   # 只演练，不改文件、不测试、不打包
 *
 * 可选参数：
 *   --dry-run        只打印将要做什么
 *   --no-changelog   不把 CHANGELOG 的「未发布 (Unreleased)」段改成新版本标题
 *
 * 脚本只做本地动作，不会 commit、不会 push、不会 publish；最后会打印下一步命令。
 * 测试在改版本号之前执行（失败不会留下半改状态），check 在改完之后执行（校验新版本契约）。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const NO_CHANGELOG = argv.includes('--no-changelog')
const targetArg = argv.find((a) => !a.startsWith('--'))

let mutated = false
let pkgPath = path.join(ROOT, 'package.json')
let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const current = pkg.version

function fail(message) {
  console.error(`\n[release] ✖ ${message}`)
  if (mutated) console.error('[release] 版本号已写入；如需回滚：git checkout -- package.json README.md README.zh.md CHANGELOG.md')
  process.exit(1)
}

function info(message) {
  console.log(`[release] ${message}`)
}

/** 统一用 shell 执行（Windows 上 npm/npx 是 .cmd），inherit 输出；capture 时返回 stdout。 */
function run(label, command, { capture = false } = {}) {
  if (DRY) {
    console.log(`[release]   [dry-run] ${command}`)
    return { status: 0, stdout: '' }
  }
  console.log(`\n[release] ▶ ${label}`)
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    if (capture && result.stderr) console.error(result.stderr.slice(0, 3000))
    fail(`${label} 失败（退出码 ${result.status ?? 'n/a'}）`)
  }
  return result
}

function npm(label, args, options) {
  return run(label, `npm ${args.join(' ')}`, options)
}

function compare(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

function resolveTarget(arg) {
  if (!arg) {
    console.error(`[release] 用法：npm run release -- <patch|minor|major|x.y.z> [--dry-run] [--no-changelog]
  当前版本：${current}
  例：npm run release -- minor`)
    process.exit(1)
  }
  if (arg === 'patch' || arg === 'minor' || arg === 'major') {
    const [major, minor, patch] = current.split('.').map(Number)
    if (arg === 'major') return `${major + 1}.0.0`
    if (arg === 'minor') return `${major}.${minor + 1}.0`
    return `${major}.${minor}.${patch + 1}`
  }
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg
  fail(`无法理解版本参数「${arg}」：只接受 patch / minor / major / x.y.z`)
}

const target = resolveTarget(targetArg)
if (compare(target, current) <= 0) {
  fail(`目标版本 ${target} 必须大于当前版本 ${current}`)
}

// ── 预检 ──────────────────────────────────────────────────────────────
const tag = `v${target}`
const tagCheck = run('检查 git 标签', `git tag -l ${tag}`, { capture: true })
if (!DRY && tagCheck.stdout.trim() === tag) fail(`标签 ${tag} 已存在，换一个版本号`)

const dirty = run('检查工作区', 'git status --porcelain', { capture: true })
if (!DRY && dirty.stdout) {
  const tracked = dirty.stdout.split('\n').filter((line) => line.trim() && !line.startsWith('??'))
  if (tracked.length > 0) {
    console.warn(`[release] ⚠ 工作区有 ${tracked.length} 个未提交的改动，它们会被一起打进这个版本：`)
    for (const line of tracked.slice(0, 8)) console.warn(`  ${line}`)
  }
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
info(`版本 ${current} → ${target}（${today}）`)

// ── 测试在改版本号之前跑，失败不留半改状态 ─────────────────────────────
const testDir = path.join(ROOT, 'test')
const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js')).sort()
if (testFiles.length === 0) fail('test/ 下没有找到 *.test.js')
if (!DRY) info(`测试 ${testFiles.length} 个文件`)
const quoted = testFiles.map((f) => JSON.stringify(path.join('test', f))).join(' ')
run('运行测试', `${JSON.stringify(process.execPath)} --test ${quoted}`)

// ── 写版本号 / README 示例 / CHANGELOG ─────────────────────────────────
if (!DRY) {
  pkg.version = target
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  mutated = true
  info(`package.json → ${target}`)

  for (const file of ['README.md', 'README.zh.md']) {
    const p = path.join(ROOT, file)
    if (!fs.existsSync(p)) continue
    const before = fs.readFileSync(p, 'utf8')
    const after = before.replace(/dsh-token-plugin-\d+\.\d+\.\d+\.tgz/g, `dsh-token-plugin-${target}.tgz`)
    if (after !== before) {
      fs.writeFileSync(p, after)
      info(`${file} 的安装示例 → ${target}`)
    }
  }

  if (!NO_CHANGELOG) {
    const changelogPath = path.join(ROOT, 'CHANGELOG.md')
    const before = fs.readFileSync(changelogPath, 'utf8')
    const after = before.replace(/^## 未发布 \(Unreleased\)[ \t]*$/m, `## v${target} (${today})`)
    if (after === before) {
      console.warn('[release] ⚠ CHANGELOG.md 里没有「## 未发布 (Unreleased)」段，跳过标题更新；发布前记得手动补更新说明')
    } else {
      fs.writeFileSync(changelogPath, after)
      info(`CHANGELOG.md → ## v${target} (${today})`)
    }
  }
}

// ── 新版本的契约校验 + 打包 ────────────────────────────────────────────
npm('插件契约校验', ['run', 'check'])

const packed = npm('打包', ['pack', '--json'], { capture: true })
let filename = ''
let size = 0
if (!DRY) {
  try {
    const parsed = JSON.parse(packed.stdout)
    filename = parsed[0]?.filename || ''
    size = parsed[0]?.size || 0
  } catch {
    const match = packed.stdout.match(/dsh-token-plugin-[\w.-]+\.tgz/)
    filename = match ? match[0] : ''
  }
  if (!filename || !fs.existsSync(path.join(ROOT, filename))) fail('npm pack 没有产出预期的 .tgz')
  if (size <= 0) {
    try { size = fs.statSync(path.join(ROOT, filename)).size } catch {}
  }
}

// ── 汇总 ──────────────────────────────────────────────────────────────
console.log(`\n[release] ────────────────────────────────────────────────`)
console.log(`[release] 版本       ${current} → ${target}`)
console.log(`[release] 测试       ${DRY ? '（dry-run 跳过）' : `${testFiles.length} 个文件全部通过`}`)
console.log(`[release] 插件契约   ${DRY ? '（dry-run 跳过）' : '通过'}`)
if (DRY) {
  console.log('[release] 打包       （dry-run 跳过）')
} else {
  console.log(`[release] 打包       ${filename}${size ? `（${(size / 1024).toFixed(1)} KB）` : ''}`)
}
console.log(`[release] ────────────────────────────────────────────────`)
console.log('[release] 下一步：')
console.log(`[release]   git add package.json README.md README.zh.md CHANGELOG.md`)
console.log(`[release]   git commit -m "release: v${target}"`)
console.log(`[release]   git tag ${tag} && git push && git push --tags`)
console.log(`[release]   npm publish                 # 发布到 npm，别人可在插件页更新`)
console.log(`[release]   npm run release:github      # 创建 GitHub Release 并上传 tgz（需 token 凭据）`)
console.log('[release] 本地自用：desktop profile 用的是 link:D:/GitHub/dsh-token-plugin，')
console.log('[release]   客户端改动刷新即可；宿主改动需重启 DSH Desktop 一次。')

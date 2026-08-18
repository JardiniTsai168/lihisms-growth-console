const { createServer } = require('node:http')
const { createReadStream, mkdirSync } = require('node:fs')
const { access, stat } = require('node:fs/promises')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const staticRoot = path.resolve(process.cwd(), 'dist', 'static')
const dataRoot = path.resolve(process.cwd(), 'data')
const databasePath = path.join(dataRoot, 'approved-archive.sqlite')
const port = Number(process.env.PORT || 3000)

mkdirSync(dataRoot, { recursive: true })

const database = new DatabaseSync(databasePath)
database.exec(`
  CREATE TABLE IF NOT EXISTS approved_creatives (
    id TEXT PRIMARY KEY,
    creative_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    creative_version TEXT NOT NULL,
    angle_id TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    product_name TEXT NOT NULL,
    use_case_id TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    copy_mode TEXT NOT NULL,
    headline TEXT NOT NULL,
    kicker TEXT NOT NULL,
    body TEXT NOT NULL,
    square_asset TEXT NOT NULL,
    final_copy_json TEXT,
    copy_deliverables_json TEXT,
    asset_deliverables_json TEXT NOT NULL,
    selected_platforms_json TEXT NOT NULL,
    benefit_ids_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_approved_creatives_approved_at
  ON approved_creatives (approved_at DESC);
`)

const insertStatement = database.prepare(`
  INSERT INTO approved_creatives (
    id,
    creative_id,
    batch_id,
    creative_version,
    angle_id,
    approved_at,
    product_name,
    use_case_id,
    prompt_version,
    copy_mode,
    headline,
    kicker,
    body,
    square_asset,
    final_copy_json,
    copy_deliverables_json,
    asset_deliverables_json,
    selected_platforms_json,
    benefit_ids_json,
    metadata_json
  ) VALUES (
    :id,
    :creative_id,
    :batch_id,
    :creative_version,
    :angle_id,
    :approved_at,
    :product_name,
    :use_case_id,
    :prompt_version,
    :copy_mode,
    :headline,
    :kicker,
    :body,
    :square_asset,
    :final_copy_json,
    :copy_deliverables_json,
    :asset_deliverables_json,
    :selected_platforms_json,
    :benefit_ids_json,
    :metadata_json
  )
  ON CONFLICT(id) DO UPDATE SET
    creative_id = excluded.creative_id,
    batch_id = excluded.batch_id,
    creative_version = excluded.creative_version,
    angle_id = excluded.angle_id,
    approved_at = excluded.approved_at,
    product_name = excluded.product_name,
    use_case_id = excluded.use_case_id,
    prompt_version = excluded.prompt_version,
    copy_mode = excluded.copy_mode,
    headline = excluded.headline,
    kicker = excluded.kicker,
    body = excluded.body,
    square_asset = excluded.square_asset,
    final_copy_json = excluded.final_copy_json,
    copy_deliverables_json = excluded.copy_deliverables_json,
    asset_deliverables_json = excluded.asset_deliverables_json,
    selected_platforms_json = excluded.selected_platforms_json,
    benefit_ids_json = excluded.benefit_ids_json,
    metadata_json = excluded.metadata_json
`)

const listStatement = database.prepare(`
  SELECT
    id,
    creative_id,
    batch_id,
    creative_version,
    angle_id,
    approved_at,
    product_name,
    use_case_id,
    prompt_version,
    copy_mode,
    headline,
    kicker,
    body,
    square_asset,
    final_copy_json,
    copy_deliverables_json,
    asset_deliverables_json,
    selected_platforms_json,
    benefit_ids_json,
    metadata_json
  FROM approved_creatives
  ORDER BY approved_at DESC
`)

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function safeJoin(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, '')
  return path.join(staticRoot, normalized)
}

async function resolveFile(urlPath) {
  const pathname = urlPath === '/' ? '/index.html' : urlPath
  const directPath = safeJoin(pathname)

  try {
    const directStat = await stat(directPath)
    if (directStat.isFile()) return directPath
  } catch {}

  if (!path.extname(pathname)) {
    const htmlPath = safeJoin(`${pathname}.html`)
    try {
      const htmlStat = await stat(htmlPath)
      if (htmlStat.isFile()) return htmlPath
    } catch {}
  }

  return safeJoin('/index.html')
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large.'))
      }
    })

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })

    req.on('error', reject)
  })
}

function normalizeRow(row) {
  return {
    id: row.id,
    creativeId: row.creative_id,
    batchId: row.batch_id,
    creativeVersion: row.creative_version,
    angleId: row.angle_id,
    approvedAt: row.approved_at,
    productName: row.product_name,
    useCaseId: row.use_case_id,
    promptVersion: row.prompt_version,
    copyMode: row.copy_mode,
    headline: row.headline,
    kicker: row.kicker,
    body: row.body,
    squareAsset: row.square_asset,
    finalCopy: row.final_copy_json ? JSON.parse(row.final_copy_json) : null,
    copyDeliverables: row.copy_deliverables_json ? JSON.parse(row.copy_deliverables_json) : null,
    assetDeliverables: JSON.parse(row.asset_deliverables_json),
    selectedPlatforms: JSON.parse(row.selected_platforms_json),
    benefitIds: JSON.parse(row.benefit_ids_json),
    metadata: JSON.parse(row.metadata_json),
  }
}

function validateArchiveItem(item) {
  const requiredFields = [
    'id',
    'creativeId',
    'batchId',
    'creativeVersion',
    'angleId',
    'approvedAt',
    'productName',
    'useCaseId',
    'promptVersion',
    'copyMode',
    'headline',
    'kicker',
    'body',
    'squareAsset',
    'assetDeliverables',
    'selectedPlatforms',
    'benefitIds',
    'metadata',
  ]

  for (const field of requiredFields) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      throw new Error(`Missing required field: ${field}`)
    }
  }
}

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type',
      })
      res.end()
      return
    }

    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(res, 200, {
        ok: true,
        count: listStatement.all().length,
        database: databasePath,
      })
      return
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/archive') {
      writeJson(res, 200, {
        ok: true,
        mode: 'server',
        items: listStatement.all().map(normalizeRow),
      })
      return
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/archive') {
      const item = await parseBody(req)
      validateArchiveItem(item)

      insertStatement.run({
        id: item.id,
        creative_id: item.creativeId,
        batch_id: item.batchId,
        creative_version: item.creativeVersion,
        angle_id: item.angleId,
        approved_at: item.approvedAt,
        product_name: item.productName,
        use_case_id: item.useCaseId,
        prompt_version: item.promptVersion,
        copy_mode: item.copyMode,
        headline: item.headline,
        kicker: item.kicker,
        body: item.body,
        square_asset: item.squareAsset,
        final_copy_json: item.finalCopy ? JSON.stringify(item.finalCopy) : null,
        copy_deliverables_json: item.copyDeliverables ? JSON.stringify(item.copyDeliverables) : null,
        asset_deliverables_json: JSON.stringify(item.assetDeliverables),
        selected_platforms_json: JSON.stringify(item.selectedPlatforms),
        benefit_ids_json: JSON.stringify(item.benefitIds),
        metadata_json: JSON.stringify(item.metadata),
      })

      writeJson(res, 201, { ok: true, mode: 'server', itemId: item.id })
      return
    }

    const filePath = await resolveFile(requestUrl.pathname)
    await access(filePath)

    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    res.writeHead(200, {
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'content-type': contentType,
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(filePath).pipe(res)
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error.',
    })
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`lihisms sites server listening on ${port}`)
})

import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
const dbPath = join(dataDir, 'approved-archive.sqlite')

mkdirSync(dataDir, { recursive: true })

const database = new DatabaseSync(dbPath)

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
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  response.end(JSON.stringify(payload))
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large.'))
      }
    })

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })

    request.on('error', reject)
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
  if (!item || typeof item !== 'object') {
    throw new Error('Archive item is required.')
  }

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

const server = createServer(async (request, response) => {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (method === 'OPTIONS') {
    return writeJson(response, 204, {})
  }

  if (method === 'GET' && url.pathname === '/health') {
    return writeJson(response, 200, {
      ok: true,
      database: dbPath,
      count: listStatement.all().length,
    })
  }

  if (method === 'GET' && url.pathname === '/api/archive') {
    const rows = listStatement.all().map(normalizeRow)
    return writeJson(response, 200, {
      ok: true,
      mode: 'server',
      items: rows,
    })
  }

  if (method === 'POST' && url.pathname === '/api/archive') {
    try {
      const item = await parseBody(request)
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

      return writeJson(response, 201, {
        ok: true,
        mode: 'server',
        itemId: item.id,
      })
    } catch (error) {
      return writeJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Archive write failed.',
      })
    }
  }

  return writeJson(response, 404, {
    ok: false,
    error: 'Not found.',
  })
})

const port = Number(process.env.PORT || 8787)
server.listen(port, () => {
  console.log(`lihisms archive api listening on http://127.0.0.1:${port}`)
  console.log(`database: ${dbPath}`)
})

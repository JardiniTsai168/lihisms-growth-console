# lihiSMS Growth Console

這個前端是 `lihiSMS` 的素材到投放工作台，流程目前是：

1. 建 use case / benefit library
2. 呼叫 `creative.bktsai.link` 產 review creatives
3. 選平台並 approve，拿回 copy 與 asset deliverables
4. 建 draft ads
5. 準備 publish bundle
6. 透過官方 Meta Ads MCP tools 嘗試建立 paused campaign / ad set / ad

## 本地開發

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## OAuth env vars

```bash
VITE_FACEBOOK_APP_ID=your_meta_app_id
VITE_FACEBOOK_GRAPH_VERSION=v26.0
VITE_ADS_MCP_GATEWAY_URL=https://creative.bktsai.link/internal/meta-ads-mcp
```

`VITE_FACEBOOK_APP_ID` 需要先在 Meta App Dashboard 設定合法的 OAuth redirect URI。GitHub Pages 測試站時，redirect URI 需要包含：

- `https://jardinitsai168.github.io/lihisms-growth-console/`

## Publish flow

目前分成兩段：

- `Connect Facebook`
  - 走 Meta OAuth implicit token flow
  - 成功後前端會用 Graph API 讀 `me/adaccounts`、`/{ad-account-id}/adspixels`、`/me/accounts`
- `Publish via Ads MCP`
  - 前端先對 `https://creative.bktsai.link/internal/meta-ads-mcp` 做 MCP `initialize`
  - relay 再轉送到 `https://mcp.facebook.com/ads`
  - 再做 `tools/list`
  - 之後依序呼叫：
    - `ads_create_campaign`
    - `ads_create_ad_set`
    - `ads_create_ad`

## 目前狀態

- 前端已不再用手拼 Graph API 寫 campaign / ad set / ad
- 寫入路徑已切成官方 Ads MCP tool flow
- UI 仍保留 Graph API 的 read path，方便看 ad account / pixel / page / live structure

## 風險與下一步

- 目前仍需用真實帳號驗證 MCP tool schema 與參數對應
- 若官方 MCP tool 的 input schema 和目前前端推斷不同，需要依 `tools/list` 回傳 schema 再細修 mapping
- 若要更穩定，下一步建議把 MCP request / tool result diagnostics 做成更明確的 debug 面板

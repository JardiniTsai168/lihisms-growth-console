# lihiSMS Growth Console

這個前端是 `lihiSMS` 的素材到投放模擬台，流程目前是：

1. 建 use case / benefit library
2. 呼叫 `creative.bktsai.link` 產 review creatives
3. 選平台並 approve，拿回 copy 與 asset deliverables
4. 建 draft ads
5. 準備 publish bundle
6. 透過 Ads MCP gateway 送出 publish request

## 本地開發

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

### OAuth env vars

```bash
VITE_FACEBOOK_APP_ID=your_meta_app_id
VITE_FACEBOOK_GRAPH_VERSION=v26.0
VITE_ADS_MCP_GATEWAY_URL=https://your-gateway.example.com/ads-mcp
```

`VITE_FACEBOOK_APP_ID` 需要先在 Meta App Dashboard 設定合法的 OAuth redirect URI。GitHub Pages 測試站時，redirect URI 需要包含：

- `https://jardinitsai168.github.io/lihisms-growth-console/`

## Ads MCP Publish Gateway

前端支援兩種模式：

- `demo`
  - 不打遠端 API
  - 前端直接模擬成功 response，方便驗證 UI flow
- `remote`
  - 對你指定的 `endpointUrl` 發 `POST`
  - backend 需代送到 Meta Ads MCP 或你的中介服務

### Request contract

Remote mode 送出的 request body：

```json
{
  "server": "https://mcp.facebook.com/ads",
  "operation": "upsert_campaign_bundle",
  "payload": {
    "server": "meta_ads_mcp",
    "version": "draft_v1",
    "operation": "upsert_campaign_bundle",
    "connection": {
      "endpoint": "https://your-gateway.example.com/ads-mcp",
      "mode": "remote",
      "adAccountId": "act_1234567890",
      "pixelId": "pixel_lihisms_demo"
    },
    "campaign": {
      "name": "lihiSMS | Prospecting | Conversions",
      "objective": "conversions",
      "buyingType": "auction",
      "status": "paused"
    },
    "adSet": {
      "name": "P01 | Broad | TW | 25-45",
      "optimizationGoal": "landing_page_views",
      "budgetStrategy": "lowest_cost",
      "placementStrategy": "advantage_plus",
      "audience": {
        "type": "broad",
        "geo": "TW",
        "ageRange": "25-45",
        "windowDays": null
      }
    },
    "creative": {
      "name": "A01 | Benefit_trackable | Brand | v1",
      "primaryText": "example primary text",
      "headline": "example headline",
      "description": "example description",
      "destinationUrl": "https://lihi.io/products/sms",
      "assetUrls": ["https://cdn.example.com/ad-1x1.png"],
      "selectedPlatforms": ["Facebook", "Instagram"]
    },
    "ad": {
      "name": "A01 | Benefit_trackable | Brand | v1",
      "reviewState": "publishing"
    }
  }
}
```

### Expected response

backend 需回 2xx，且 body 至少包含：

```json
{
  "requestId": "req_demo_123456",
  "campaignId": "cmp_abc123",
  "adSetId": "adset_def456",
  "adId": "ad_xyz789",
  "status": "accepted"
}
```

### 前端行為

- `Connect Facebook` 會直接走 Meta OAuth implicit token flow
- 成功後前端會用 Graph API 讀 `me/adaccounts` 與 `/{ad-account-id}/adspixels`
- 2xx + 完整 JSON：draft 進 `published`
- 非 2xx：draft 進 `failed`
- 缺少必要欄位或 response 不是合法 JSON：draft 也會進 `failed`

## 建議下一步

如果要接真實 backend，建議下一段做：

1. backend 驗證 `adAccountId` / `pixelId`
2. backend 建 campaign / ad set / ad creative 的 idempotency strategy
3. backend 回傳更完整的 Meta trace / error payload

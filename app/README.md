# lihiSMS Growth Console

這版已改成 approved archive workflow：

1. 建 use case / benefit library
2. 呼叫 `creative.bktsai.link` 產 review creatives
3. 人工選平台後按 `Approve to DB`
4. 前端呼叫 `generate-formats` 拿文案與版位素材
5. 只要 creative 狀態變成 `approved`，就自動寫入瀏覽器內建 `IndexedDB`

## 本地開發

```bash
pnpm install
pnpm dev
```

Production build:

```bash
pnpm build
```

## Archive Database

- database: `lihisms-approved-archive`
- object store: `approved_creatives`
- write timing: `approve` 成功後立即寫入
- stored fields:
  - creative / batch ids
  - final approved copy
  - returned asset deliverables
  - selected platforms
  - product / use case / benefit metadata

## Removed

- `facebook MCP`
- OAuth / ad account / page / pixel connection flow
- draft ad / publish bundle / publish via Ads MCP

## Deploy

推到 `main` 後，GitHub Actions 會自動部署到 GitHub Pages。

# lihiSMS Growth Console

A single-operator MVP for managing the lihiSMS acquisition loop:

- structure strategy inputs
- generate three-image creative batches
- review and approve assets
- create Facebook draft ads
- ingest the core funnel
- recommend next actions without auto-executing

## Product contract

- Main KPI: `email verified signup`
- Main ICP: `電商品牌`
- Main promise: `可追蹤點擊與成效的簡訊行銷`
- Landing page stays fixed in this MVP
- The system suggests actions, but Tony stays the final decision-maker

## App

The deployable app lives in [`app/`](./app).

### Local run

```bash
cd app
pnpm install
pnpm dev
```

### Build

```bash
cd app
pnpm build
```

## Ticket workspace

The approved tracer-bullet tickets live in [`.scratch/lihisms-growth-console/issues/`](./.scratch/lihisms-growth-console/issues/).

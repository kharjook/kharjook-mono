# Kharjook (خرجوک)

Persian RTL personal finance PWA — assets, wallets, cashflow, loans, goals, and Telegram notifications.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Copy [`.env.example`](.env.example) and set Supabase + Telegram + cron secrets.

## Database migrations

Migrations live in [`supabase/migrations/`](supabase/migrations/). Apply in filename order on your Supabase project (SQL editor or CLI):

```bash
supabase db push
# or run each .sql file manually in the Supabase dashboard
```

| Migration | Purpose |
|-----------|---------|
| `20250602120000_add_transaction_operation_id.sql` | Transaction grouping |
| `20250603120000_telegram_notifications.sql` | Telegram + notification tables |
| `20250604120000_telegram_bot_enhancements.sql` | Bot menu state, price alerts |
| `20250605120000_wallet_payment_details.sql` | Wallet card/IBAN fields |
| `20250606120000_wallet_account_owner_name.sql` | Account holder name |
| `20250607120000_expense_alert_enabled.sql` | Expense alert toggle column |
| `20250608120000_performance_indexes.sql` | Query indexes |
| `20250608130000_expense_alert_default_off.sql` | Expense alerts opt-in (default off) |
| `20250608140000_expense_alert_delivery_kind.sql` | Dedup enum for expense alerts |
| `20250608150000_cashflow_rpc.sql` | SQL aggregates for cashflow |

**Baseline schema:** Core tables (`transactions`, `assets`, `wallets`, …) predate these incremental migrations. To capture full prod schema in git:

```bash
supabase link --project-ref YOUR_REF
supabase db pull
```

Commit the generated snapshot so new contributors can audit RLS and indexes.

## Telegram notifications

1. Create a bot via [@BotFather](https://t.me/BotFather).
2. Apply all migrations above.
3. Deploy and register webhook: `https://YOUR_DOMAIN/api/telegram/webhook`
4. In app **Settings**, connect Telegram and configure toggles:
   - **Debt reminder** — daily 09:00 Tehran, today's installments only
   - **Price change alert** — after manual price refresh in bot
   - **Expense alert** — opt-in; message on each new expense

Manual cron test:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/notifications
```

## Deploy on Vercel

Cron is defined in [`vercel.json`](vercel.json) (`30 5 * * *` UTC ≈ 09:00 Asia/Tehran).

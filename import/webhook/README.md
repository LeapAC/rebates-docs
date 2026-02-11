# webhook-config

Per-organization webhook URL and custom field names for **backend-triggered** webhooks. OpenAPI spec: `openapi.json`.

When an org has a webhook URL configured, the backend sends a `POST` to that URL after every successful incentive lookup (single `POST /incentives` and each completed batch item). Payload shape matches the incentive response plus any custom fields (e.g. Project ID, Record ID).

## Endpoints

- **GET /webhook-config** – Return the authenticated org’s webhook URL and field names.
- **PUT /webhook-config** – Set or clear URL and/or field names (partial update supported).

## Authentication

Clerk Bearer token or API key (organization-scoped).

## Request/Response

**GET** – No body.

Response:
```json
{
  "url": "https://your-server.com/webhook",
  "field_names": ["Project ID", "Record ID"]
}
```

**PUT** – Body (all fields optional):
```json
{
  "url": "https://your-server.com/webhook",
  "field_names": ["Project ID", "Record ID"]
}
```
Use `null` or `""` for `url` to clear. Response same as GET. Webhook URLs must use **HTTPS** (validation returns `"Webhook URL must use HTTPS"` or `"Invalid URL format"` if not).

## Usage

1. Portal (Developer → Webhook Configuration): load/save via GET and PUT so config is stored per org in the backend instead of localStorage.
2. Single lookups: include `webhook_custom_fields: { "Project ID": "...", "Record ID": "..." }` in `POST /incentives` so the backend merges them into the webhook payload.
3. Batch: include `webhook_custom_fields` on each item in `POST /batch-lookups` (e.g. from CSV columns); the worker passes them to `/incentives`, and the backend sends the webhook per item with those fields.

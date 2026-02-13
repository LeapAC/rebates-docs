# Batch Lookups API

API for processing large volumes of incentive lookups via a queue-based system. Upload CSV data as batch jobs, track progress, and retrieve results.

## Base Path

`/batch-lookups`

## Overview

The Batch Lookups API enables you to:

- **Upload CSV data** as batch jobs with multiple addresses
- **Track progress** in real-time as items are processed
- **Retrieve results** for individual lookups or entire batches
- **Automatic reports** - completed jobs automatically generate incentive reports

## Architecture

```
┌─────────────┐
│   Portal    │  POST /batch-lookups
│  (Frontend) │──────────────────────┐
└─────────────┘                      │
                                     ▼
                          ┌──────────────────┐
                          │  batch-lookups    │
                          │   Edge Function   │
                          └──────────────────┘
                                     │
                                     ▼
                          ┌──────────────────┐
                          │  Database Queue   │
                          │ lookup_queue_items│
                          └──────────────────┘
                                     │
                                     ▼
                          ┌──────────────────┐
                          │  Worker (pg_cron)│
                          │  Every 5 minutes │
                          └──────────────────┘
                                     │
                                     ▼
                          ┌──────────────────┐
                          │  /incentives API │
                          │  (per item)      │
                          └──────────────────┘
                                     │
                                     ▼
                          ┌──────────────────┐
                          │  Results Stored   │
                          │  + Auto Reports   │
                          └──────────────────┘
```

## Authentication

All endpoints support two authentication methods:

### API Key (for integrations)
```
x-api-key: leap_live_<your_api_key>
```

### Clerk Bearer Token (for portal)
```
Authorization: Bearer <clerk_jwt_token>
```

**Note:** Provide either `x-api-key` OR `Authorization`, not both.

## Queue Processing

### Automatic Processing
- Background worker runs **every 5 minutes**
- Processes **10 items per run**
- **100ms delay** between items (rate limiting)
- **Maximum 3 retries** for failed items

### Manual Trigger
You can manually trigger the worker:
```bash
curl -X POST "https://api.incentives.leap.energy/alpha/batch-lookups-worker" \
  -H "Authorization: Bearer <service_role_key>" \
  -H "x-supabase-internal: true" \
  -d '{}'
```

## Endpoints

### 1. POST /batch-lookups

Create a new batch job with multiple lookup items.

**Request:**
```json
{
  "items": [
    {
      "reference_id": "deal-001",
      "address": {
        "street_1": "123 Main St",
        "city": "San Francisco",
        "state_or_province_code": "CA",
        "postal_code": "94102",
        "country_code": "US"
      },
      "building_type": "RESIDENTIAL",
      "device_ids": [1],
      "create_application": false
    }
  ]
}
```

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "total_items": 1,
  "created_at": "2026-01-26T15:30:00.000Z",
  "report": {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "name": "Batch Lookup - 2026-01-26 (1 sites)",
    "description": "Batch lookup job with 1 items. Sites will be added as processing completes.",
    "status": "processing",
    "report_type": "bulk_lookup",
    "total_sites": 0,
    "created_at": "2026-01-26T15:30:00.000Z"
  },
  "message": "Batch job created with 1 items. Report is available immediately and sites will be added as processing completes. Poll GET /batch-lookups/{job_id} for job status."
}
```

**Key Points:**
- Each item can have different `device_ids`
- Each item can have different `create_application` setting
- Maximum 10,000 items per batch
- All items validated before job creation
- Duplicate `reference_id` values are rejected

### 2. GET /batch-lookups

List all batch jobs for your organization.

**Query Parameters:**
- `status` - Filter by: `pending`, `processing`, `completed`, `failed`, `cancelled`
- `limit` - Results per page (default: 20, max: 200)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "jobs": [
    {
      "id": "...",
      "status": "completed",
      "total_items": 100,
      "processed_items": 100,
      "failed_items": 0,
      "report_id": "...",
      "created_at": "...",
      "completed_at": "...",
      "item_counts": {
        "pending": 0,
        "processing": 0,
        "completed": 100,
        "failed": 0
      }
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### 3. GET /batch-lookups/{job_id}

Get detailed status for a specific batch job.

**Query Parameters:**
- `include_items` - Include full item details (default: false)

**Response:**
```json
{
  "id": "...",
  "status": "processing",
  "total_items": 100,
  "processed_items": 45,
  "failed_items": 2,
  "created_at": "...",
  "started_at": "...",
  "completed_at": null,
  "item_counts": {
    "pending": 50,
    "processing": 5,
    "completed": 43,
    "failed": 2
  }
}
```

### 4. GET /batch-lookups/{job_id}/items

Get all items (lookups) for a batch job.

**Query Parameters:**
- `status` - Filter by: `pending`, `processing`, `completed`, `failed`
- `limit` - Results per page (default: 50, max: 500)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "items": [
    {
      "id": "...",
      "status": "completed",
      "reference_id": "deal-001",
      "address": { ... },
      "device_ids": [1],
      "result": {
        "customer_id": 1234,
        "utility": { "name": "..." },
        "incentives": {
          "total_incentive_amount": 1500.00,
          "by_program": []
        }
      },
      "error_message": null,
      "retry_count": 0,
      "created_at": "...",
      "processed_at": "..."
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### 5. POST /batch-lookups/{job_id}/cancel

Cancel a pending or processing batch job.

**Response:**
```json
{
  "message": "Job cancelled successfully",
  "job_id": "..."
}
```

## Status Flow

### Job Status
```
pending → processing → completed/failed
                ↓
           cancelled
```

### Item Status
```
pending → processing → completed/failed
                          ↓ (if retries < 3)
                       pending (retry)
```

## Integration with Incentive Reports

**Report Creation Flow:**

1. **Report Created Immediately**
   - When you create a batch job, an `incentive_reports` record is created **immediately**
   - Report type: `bulk_lookup`
   - Report name: `Batch Lookup - {date} ({count} sites)`
   - Report status: `processing` (sites being added)
   - Report ID is included in the batch job creation response

2. **Sites Added Incrementally**
   - As each queue item completes processing, it's automatically added to the report
   - Sites appear in real-time as items finish (not all at once at the end)
   - Address, device category, and results are stored for each site
   - Programs are linked to sites automatically

3. **Report Finalization**
   - When the batch job completes, the report status updates to `complete`
   - If all items fail, report status updates to `error`
   - Report aggregates (total_sites, eligible_sites, total_incentive_value) are calculated automatically

**Access the report:**
```bash
# Report ID is included in batch creation response
POST /batch-lookups
# Returns: { "report": { "id": "..." }, ... }

# Or get report ID from job
GET /batch-lookups/{job_id}
# Returns: { "report_id": "..." }

# Get full report details with sites
GET /incentive-reports/{report_id}
```

**Benefits:**
- ✅ Report available immediately (no waiting for job completion)
- ✅ Real-time progress (sites appear as they complete)
- ✅ Better UX (users can view partial results)
- ✅ No blocking (report creation doesn't delay job processing)

## Common Workflows

### Workflow 1: CSV Upload

```javascript
// 1. Parse CSV
const csvData = parseCSV(file);
const items = csvData.map(row => ({
  reference_id: row.deal_id,
  address: {
    street_1: row.address,
    city: row.city,
    state_or_province_code: row.state,
    postal_code: row.zip,
    country_code: 'US'
  },
  building_type: 'RESIDENTIAL',
  device_ids: [1] // or from CSV
}));

// 2. Create batch job
const response = await fetch('/batch-lookups', {
  method: 'POST',
  headers: { 'x-api-key': API_KEY },
  body: JSON.stringify({ items })
});

const { job_id } = await response.json();

// 3. Poll for completion
const job = await pollJobStatus(job_id);

// 4. Get results
const results = await fetch(`/batch-lookups/${job_id}/items?status=completed`);
const { items: completedItems } = await results.json();

// 5. Export to CSV or display
```

### Workflow 2: Real-time Progress

```javascript
// Using Supabase Realtime (if enabled)
const channel = supabase
  .channel('batch-jobs')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'batch_lookup_jobs',
    filter: `id=eq.${job_id}`
  }, (payload) => {
    updateProgressBar(payload.new);
  })
  .subscribe();

// Or polling
setInterval(async () => {
  const job = await getJobStatus(job_id);
  updateUI(job);
}, 5000); // Every 5 seconds
```

### Workflow 3: Error Handling

```javascript
// Get failed items
const failed = await fetch(
  `/batch-lookups/${job_id}/items?status=failed`
);

const { items: failedItems } = await failed.json();

// Retry failed items by creating a new batch
const retryItems = failedItems.map(item => ({
  reference_id: item.reference_id,
  address: item.address,
  building_type: item.building_type,
  device_ids: item.device_ids
}));

const retryJob = await createBatch({ items: retryItems });
```

## Error Handling

### Validation Errors

**400 Bad Request** - Invalid input:
```json
{
  "error": "5 item(s) failed validation",
  "invalid_items": [
    {
      "index": 0,
      "error": "Missing required fields..."
    }
  ],
  "total_invalid": 5
}
```

**400 Bad Request** - Duplicate reference_ids:
```json
{
  "error": "Duplicate reference_ids found in batch",
  "duplicates": ["deal-001", "deal-002"]
}
```

### Not Found

**404 Not Found** - Job doesn't exist or doesn't belong to your organization:
```json
{
  "error": "Batch job not found"
}
```

### Authorization

**401 Unauthorized** - Missing or invalid authentication:
```json
{
  "error": "Missing authentication. Provide either x-api-key or Authorization: Bearer token."
}
```

## Rate Limits & Performance

### Processing Capacity
- **10 items per worker run**
- **Every 5 minutes** = 120 items/hour capacity
- **100ms delay** between items (configurable)

### Recommendations
- **Small batches (< 100 items)**: Process in seconds
- **Medium batches (100-1000 items)**: Process in 1-2 minutes
- **Large batches (1000+ items)**: Process in 5-10 minutes

### Best Practices
1. **Batch size**: Keep batches under 10,000 items
2. **Polling**: Poll every 5-10 seconds for status updates
3. **Error handling**: Check `failed_items` and retry if needed
4. **CSV parsing**: Validate addresses before creating batch

## Examples

### Complete Example: CSV Upload Flow

```javascript
async function uploadCSV(csvFile) {
  // 1. Parse CSV
  const rows = await parseCSV(csvFile);
  
  // 2. Transform to API format
  const items = rows.map(row => ({
    reference_id: row['Deal ID'],
    address: {
      street_1: row['Street Address'],
      city: row['City'],
      state_or_province_code: row['State'],
      postal_code: row['ZIP'],
      country_code: 'US'
    },
    building_type: 'RESIDENTIAL',
    device_ids: [1], // or from CSV
    create_application: false
  }));
  
  // 3. Create batch job
  const createResponse = await fetch(
    'https://api.incentives.leap.energy/alpha/batch-lookups',
    {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items })
    }
  );
  
  if (!createResponse.ok) {
    const error = await createResponse.json();
    throw new Error(error.error);
  }
  
  const { job_id } = await createResponse.json();
  console.log(`Created job: ${job_id}`);
  
  // 4. Poll for completion
  let job;
  do {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusResponse = await fetch(
      `https://api.incentives.leap.energy/alpha/batch-lookups/${job_id}`,
      { headers: { 'x-api-key': API_KEY } }
    );
    job = await statusResponse.json();
    console.log(`Progress: ${job.processed_items}/${job.total_items}`);
  } while (job.status === 'pending' || job.status === 'processing');
  
  // 5. Get results
  const itemsResponse = await fetch(
    `https://api.incentives.leap.energy/alpha/batch-lookups/${job_id}/items?status=completed`,
    { headers: { 'x-api-key': API_KEY } }
  );
  
  const { items: results } = await itemsResponse.json();
  
  // 6. Export to CSV
  const csv = [
    'reference_id,customer_id,utility,total_incentive',
    ...results.map(item => [
      item.reference_id,
      item.result?.customer_id || '',
      item.result?.utility?.name || '',
      item.result?.incentives?.total_incentive_amount || 0
    ].join(','))
  ].join('\n');
  
  return { job_id, results, csv, report_id: job.report_id };
}
```

## OpenAPI Specification

Full API documentation available in `openapi.json`:
- Import into Postman, Insomnia, or Swagger UI
- Generate client SDKs
- Interactive API explorer

## Related APIs

- **Webhook Config API** (`/webhook-config`) - Configure webhook URL and custom field names; completed lookups (single and batch) trigger a POST to your URL (see `webhook-config/openapi.json`)
- **Incentive Reports API** (`/incentive-reports`) - Access reports created by batch jobs
- **Incentives API** (`/incentives`) - Single lookup endpoint (used internally by worker)
- **Applications API** (`/applications`) - Manage rebate applications

## Support

For questions or issues:
- Check the [Review Document](../BATCH_LOOKUPS_REVIEW.md) for optimization tips
- See [Deployment Guide](../batch-lookups-worker/BATCH_LOOKUPS_DEPLOYMENT.md) for production setup
- Contact: support@leap.energy

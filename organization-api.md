# Organization API Key Documentation

This document describes all API endpoints accessible with an **organization API key**. Organization keys are scoped to a specific organization and can only access applications belonging to that organization.

## Authentication

All endpoints require:

- **Header**: `x-api-key: <ORG_API_KEY>`
  - Organization API keys have the `leap_live_` prefix
  - The associated organization must have `admin: false` (or not set) in the `organizations` table
  - Organization keys are automatically scoped to the organization associated with the API key

## Base URL

```
https://api.incentives.leap.energy/alpha
```

---

## Endpoints

### 1. List Applications

**GET** `/applications`

List applications belonging to your organization. Optionally filter by `refId` to scope to a specific customer within your organization.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `refId` | string | No | Reference ID to filter applications for a specific customer within your organization |
| `application_status` | string | No | Filter by status: `not_started`, `in_progress`, `awaiting_partner`, `completed`, `submitted`, `approved`, `rejected` |
| `limit` | number | No | Number of results per page (default: 50, max: 100) |
| `page_token` | string | No | Pagination token from previous response |

#### Request Example (All Organization Applications)

```bash
curl "https://api.incentives.leap.energy/alpha/applications?limit=50" \
  -H "x-api-key: leap_live_..."
```

#### Request Example (Filtered by refId)

```bash
curl "https://api.incentives.leap.energy/alpha/applications?refId=982734ihksjhfwoe8u&limit=50" \
  -H "x-api-key: leap_live_..."
```

#### Response (200 OK)

```json
{
  "next_page_token": "eyJpZCI6MjN9",
  "results": [
    {
      "id": 27,
      "program_id": 245,
      "customer_id": 1109,
      "organization_id": "ee6e7900-30ae-400f-8a34-8554ec666f3a",
      "status": "submitted",
      "rebate_type": "rebate",
      "total_requested_amount": 500.00,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "customer": {
        "id": 1109,
        "first_name": "John",
        "last_name": "Doe",
        "email": "john@example.com",
        "phone": "+1234567890",
        "address_line1": "123 Main St",
        "city": "Austin",
        "state": "TX",
        "zip_code": "78701"
      }
    }
  ]
}
```

#### Error Responses

- **400 Bad Request**: Invalid query parameters
- **401 Unauthorized**: Invalid or missing API key
- **404 Not Found**: No customer found for `refId` (when using refId)
- **500 Internal Server Error**: Unexpected error

---

### 2. Get Application by ID

**GET** `/applications/{application_id}`

Retrieve a single application by ID. The application must belong to your organization. Optionally verify it belongs to a specific customer using `refId`.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `refId` | string | No | Reference ID to verify the application belongs to a specific customer within your organization |

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes | Application ID |

#### Request Example

```bash
curl "https://api.incentives.leap.energy/alpha/applications/27" \
  -H "x-api-key: leap_live_..."
```

#### Request Example (with refId verification)

```bash
curl "https://api.incentives.leap.energy/alpha/applications/27?refId=982734ihksjhfwoe8u" \
  -H "x-api-key: leap_live_..."
```

#### Response (200 OK)

```json
{
  "id": 27,
  "program_id": 245,
  "customer_id": 1109,
  "organization_id": "ee6e7900-30ae-400f-8a34-8554ec666f3a",
  "status": "submitted",
  "rebate_type": "rebate",
  "total_requested_amount": 500.00,
  "customer_device_id": [123, 124],
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "customer": {
    "id": 1109,
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "address_line1": "123 Main St",
    "address_line2": null,
    "city": "Austin",
    "state": "TX",
    "zip_code": "78701",
    "customer_devices": [
      {
        "id": 123,
        "device_id": 5,
        "quantity": 1,
        "purchase_price": 500.00,
        "installation_cost": 200.00
      }
    ]
  }
}
```

#### Error Responses

- **400 Bad Request**: Invalid `application_id`
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Application does not belong to your organization, or (if using refId) does not belong to the customer associated with `refId`
- **404 Not Found**: Application or customer not found
- **500 Internal Server Error**: Unexpected error

---

### 3. Update Application (PATCH)

**PATCH** `/applications/{application_id}`

Update an application belonging to your organization. The `application_id` must be provided as a path parameter.

**Important**: Organization keys **must** use the path-based `/applications/{application_id}` endpoint. They **cannot** use the query parameter-based `/applications?refId=...` endpoint (that's for admin keys only).

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dryRun` | boolean | No | If `true`, validates and returns what would be changed without making changes (default: `false`) |

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes | Application ID (must belong to your organization) |

#### Request Body

```json
{
  "status": "submitted",
  "total_requested_amount": 500.00,
  "customer_device_id": [123],
  "customer": {
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com"
  },
  "customer_devices": [
    {
      "id": 123,
      "device_id": 5,
      "quantity": 1,
      "purchase_price": 500.00
    }
  ]
}
```

#### Request Example (Dry Run)

```bash
curl -X PATCH "https://api.incentives.leap.energy/alpha/applications/27?dryRun=true" \
  -H "x-api-key: leap_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "status": "submitted"
  }'
```

#### Response (200 OK - Dry Run)

```json
{
  "ok": true,
  "requestId": "a6fb0c27-d4e8-4ed9-b8b1-3a84024eaf6f",
  "dryRun": true,
  "application_id": 27,
  "organization_id": "ee6e7900-30ae-400f-8a34-8554ec666f3a",
  "validations": {
    "applications_checked": 1,
    "devices_checked": 0,
    "strictStatusTransitions": true
  },
  "wouldMutate": {
    "customer_devices": [],
    "applications": [
      {
        "status": "submitted"
      }
    ]
  }
}
```

#### Response (200 OK - Actual Update)

```json
{
  "ok": true,
  "requestId": "a6fb0c27-d4e8-4ed9-b8b1-3a84024eaf6f",
  "application_id": 27,
  "organization_id": "ee6e7900-30ae-400f-8a34-8554ec666f3a",
  "updated": {
    "customer": { "id": 1109 },
    "customer_devices": [],
    "applications": [{ "id": 27 }]
  }
}
```

#### Error Responses

- **400 Bad Request**: 
  - Invalid request body
  - Status transition validation failed
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Application does not belong to your organization
- **404 Not Found**: Application not found
- **500 Internal Server Error**: Unexpected error

---

### 4. Create Attachment Upload URL

**POST** `/applications/attachments`

Create a signed upload URL for uploading a file attachment. Organization keys must use `application_id` query parameter.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes | Application ID (must belong to your organization) |

#### Request Body

```json
{
  "attachment_type": "INVOICE_EQUIPMENT",
  "filename": "invoice.pdf",
  "contentType": "application/pdf"
}
```

#### Request Example

```bash
curl -X POST "https://api.incentives.leap.energy/alpha/applications/attachments?application_id=27" \
  -H "x-api-key: leap_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "attachment_type": "INVOICE_EQUIPMENT",
    "filename": "invoice.pdf",
    "contentType": "application/pdf"
  }'
```

#### Response (200 OK)

```json
{
  "ok": true,
  "requestId": "req_1234567890",
  "uploadUrl": "https://...supabase.co/storage/v1/object/sign/attachments/...",
  "path": "app-27/uuid-invoice.pdf",
  "bucket": "attachments",
  "instructions": "PUT bytes to uploadUrl with the file content-type, then call POST /applications/attachments/commit to finalize."
}
```

#### Valid Attachment Types

- `INVOICE_EQUIPMENT`
- `INVOICE_INSTALL`
- `PERMIT`
- `PHOTO_NAMEPLATE`
- `PHOTO_INSTALL`
- `PHOTO_METER`
- `AHRI_CERT`
- `NEAT_REPORT`
- `INCOME_FORM`
- `W9`
- `OTHER`

#### Error Responses

- **400 Bad Request**: Missing required parameters, invalid attachment type
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Application does not belong to your organization
- **404 Not Found**: Application not found
- **500 Internal Server Error**: Unexpected error

---

### 5. Commit Attachment Upload

**POST** `/applications/attachments/commit`

Finalize an attachment upload after the file has been uploaded to the signed URL. Organization keys must use `application_id` query parameter.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes | Application ID (must belong to your organization) |

#### Request Body

```json
{
  "attachment_type": "INVOICE_EQUIPMENT",
  "path": "app-27/uuid-invoice.pdf",
  "makePublic": false
}
```

#### Request Example

```bash
curl -X POST "https://api.incentives.leap.energy/alpha/applications/attachments/commit?application_id=27" \
  -H "x-api-key: leap_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "attachment_type": "INVOICE_EQUIPMENT",
    "path": "app-27/uuid-invoice.pdf",
    "makePublic": false
  }'
```

#### Response (200 OK)

```json
{
  "ok": true,
  "requestId": "req_1234567890",
  "id": 456,
  "file_url": "storage://attachments/app-27/uuid-invoice.pdf",
  "bucket": "attachments",
  "path": "app-27/uuid-invoice.pdf"
}
```

#### Error Responses

- **400 Bad Request**: Missing required parameters, invalid attachment type
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Application does not belong to your organization
- **404 Not Found**: 
  - Application not found
  - Object not found in storage (upload may have failed)
- **500 Internal Server Error**: Unexpected error

---

### 6. List Attachments

**GET** `/applications/attachments`

List attachments for one or more applications. Organization keys must use `application_id` or `application_ids` query parameter.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes* | Application ID (must belong to your organization) |
| `application_ids` | string | Yes* | Comma-separated list of application IDs (e.g., "1,2,3") for bulk listing (all must belong to your organization) |
| `attachment_type` | string | Yes** | Attachment type (see valid types below). Required when using single `application_id`, optional when using `application_ids` |

*Either `application_id` or `application_ids` is required.

**`attachment_type` is required when using single `application_id`, but optional when using `application_ids` (bulk mode). When omitted in bulk mode, all attachment types are returned.

#### Request Example (single application)

```bash
curl "https://api.incentives.leap.energy/alpha/applications/attachments?application_id=27&attachment_type=INVOICE_EQUIPMENT" \
  -H "x-api-key: leap_live_..."
```

#### Request Example (bulk mode with application_ids)

```bash
curl "https://api.incentives.leap.energy/alpha/applications/attachments?application_ids=27,28,29" \
  -H "x-api-key: leap_live_..."
```

#### Request Example (bulk mode with application_ids and attachment_type filter)

```bash
curl "https://api.incentives.leap.energy/alpha/applications/attachments?application_ids=27,28,29&attachment_type=INVOICE_EQUIPMENT" \
  -H "x-api-key: leap_live_..."
```

#### Response (200 OK)

```json
{
  "ok": true,
  "requestId": "req_1234567890",
  "attachments": [
    {
      "id": 456,
      "application_id": 27,
      "attachment_type": "INVOICE_EQUIPMENT",
      "file_url": "storage://attachments/app-27/uuid-invoice.pdf",
      "filename": "invoice.pdf",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": 457,
      "application_id": 28,
      "attachment_type": "PERMIT",
      "file_url": "storage://attachments/app-28/uuid-permit.pdf",
      "filename": "permit.pdf",
      "created_at": "2024-01-15T11:00:00Z",
      "updated_at": "2024-01-15T11:00:00Z"
    }
  ]
}
```

#### Empty Response (No Attachments Found)

```json
{
  "ok": true,
  "requestId": "req_1234567890",
  "attachments": []
}
```

#### Valid Attachment Types

- `INVOICE_EQUIPMENT`
- `INVOICE_INSTALL`
- `PERMIT`
- `PHOTO_NAMEPLATE`
- `PHOTO_INSTALL`
- `PHOTO_METER`
- `AHRI_CERT`
- `NEAT_REPORT`
- `INCOME_FORM`
- `W9`
- `OTHER`

#### Error Responses

- **400 Bad Request**: 
  - Missing `attachment_type` parameter (when using single `application_id`)
  - Invalid `attachment_type`
  - Missing `application_id` or `application_ids` parameter
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Application(s) do not belong to your organization
- **404 Not Found**: Application(s) not found
- **500 Internal Server Error**: Unexpected error

---

### 7. Get Attachment Download URL

**GET** `/applications/attachments/{id}/download`

Get a signed download URL for an attachment. The URL is valid for 1 hour. Organization keys must use `application_id` query parameter.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes | Application ID (must belong to your organization) |

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Attachment ID |

#### Request Example

```bash
curl "https://api.incentives.leap.energy/alpha/applications/attachments/456/download?application_id=27" \
  -H "x-api-key: leap_live_..."
```

#### Response (200 OK)

```json
{
  "ok": true,
  "requestId": "req_1234567890",
  "downloadUrl": "https://...supabase.co/storage/v1/object/sign/attachments/...?token=...",
  "url": "https://...supabase.co/storage/v1/object/sign/attachments/...?token=...",
  "file_url": "https://...supabase.co/storage/v1/object/sign/attachments/...?token=..."
}
```

**Note**: The response includes three fields (`downloadUrl`, `url`, `file_url`) all containing the same signed URL for compatibility.

#### Error Responses

- **400 Bad Request**: Missing required parameters
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Attachment does not belong to your organization
- **404 Not Found**: Attachment or application not found
- **500 Internal Server Error**: Unexpected error or invalid file URL format

---

### 8. Delete Attachment

**DELETE** `/applications/attachments/{id}`

Delete an attachment from storage and remove the database record. Organization keys must use `application_id` query parameter.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `application_id` | number | Yes | Application ID (must belong to your organization) |

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Attachment ID |

#### Request Example

```bash
curl -X DELETE "https://api.incentives.leap.energy/alpha/applications/attachments/456?application_id=27" \
  -H "x-api-key: leap_live_..."
```

#### Response (204 No Content)

Empty response body with status `204 No Content`.

#### Error Responses

- **400 Bad Request**: Missing required parameters
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Attachment does not belong to your organization
- **404 Not Found**: Attachment or application not found
- **500 Internal Server Error**: Unexpected error or invalid file URL format

---

## Common Error Response Format

All error responses follow this format:

```json
{
  "code": "error_code",
  "message": "Human-readable error message",
  "requestId": "unique-request-id"
}
```

### Common Error Codes

- `unauthorized`: Invalid or missing API key
- `bad_request`: Invalid request parameters or body
- `not_found`: Resource not found
- `forbidden`: Access denied (resource belongs to different organization)
- `internal_error`: Unexpected server error
- `invalid_body`: Request body validation failed
- `blocked_email_domain`: Email domain is blocked
- `invalid_status_transition`: Status transition is not allowed

---

## Notes

1. **Organization Scoping**: 
   - All operations are automatically scoped to your organization
   - You can only access applications where `organization_id` matches your API key's organization
   - Attempting to access applications from other organizations will return `403 Forbidden`

2. **refId Parameter**: 
   - The `refId` parameter can be used with GET endpoints to filter/verify by customer
   - When using `refId`, the system verifies that the customer belongs to your organization
   - `refId` is resolved to both `customer_id` and `organization_id` from the `customer_organizations` table
   - Applications must match both the customer and organization associated with the `refId`

3. **PATCH Endpoint Restriction**: 
   - Organization keys **must** use `PATCH /applications/{application_id}` (path param)
   - Organization keys **cannot** use `PATCH /applications?refId=...` (that's for admin keys only)
   - This is enforced to maintain clear separation between admin and org key modes

4. **Dry Run Mode**: 
   - Available for PATCH operations
   - Set `dryRun=true` query parameter
   - Returns what would be changed without making actual changes
   - Useful for validation before committing updates

5. **Attachment Upload Flow**:
   1. Call `POST /applications/attachments?application_id={id}` to get signed upload URL
   2. Upload file using `PUT` to the returned `uploadUrl` with appropriate `Content-Type` header
   3. Call `POST /applications/attachments/commit?application_id={id}` to finalize and create database record

6. **Pagination**: 
   - List endpoints support pagination via `limit` and `page_token` parameters
   - Use `next_page_token` from response to fetch next page
   - Maximum `limit` is 100

7. **Status Values**: 
   - Valid application statuses: `not_started`, `in_progress`, `awaiting_partner`, `completed`, `submitted`, `approved`, `rejected`
   - Status transitions may be restricted based on configuration


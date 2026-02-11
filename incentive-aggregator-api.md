# Incentive Aggregator

Edge function that aggregates incentive calculations across multiple utility programs for a given address and device.

## Overview

This function:

1. Validates the API key
2. Finds or creates a customer record based on operation type
3. Links customer to the user's organization with a reference_id
4. Looks up utility programs (via address lookup or cached utilities)
5. Calculates incentives across all applicable programs
6. Optionally creates/updates application records
7. Logs API calls for auditing
8. Returns aggregated incentive data with Connect URL (if create_application is true)

## Authentication

The function supports two mutually-exclusive authentication methods:

### Method 1: API Key (for integrations)

**Header:** `x-api-key`

```
x-api-key: leap_live_<your_api_key>
```

To generate an API key:

1. Login to your account (get JWT token)
2. Call the `/api-key-manager` endpoint with your JWT
3. Save the returned API key securely

See [API Key Manager documentation](../api-key-manager/README.md) for details.

### Method 2: Bearer Token (Leap dashboard)

**Header:** `Authorization`

Bearer token authentication is used by the Leap dashboard. For your API integrations, use the API key (Method 1) above.

**Important:** Provide either `x-api-key` OR `Authorization`, not both. If both headers are present, the request will be rejected with a 400 error.

## Endpoint

**POST /incentives**

## Request

**Headers:**

```
# Option 1: API Key (for integrations)
x-api-key: leap_live_abc123...
Content-Type: application/json

# Option 2: Bearer Token (Leap dashboard only)
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**

```json
{
  "operation_type": "lookup",
  "reference_id": "external-ref-123",
  "address": {
    "street_1": "123 Main St",
    "street_2": "Apt 4B",
    "city": "San Francisco",
    "state_or_province_code": "CA",
    "postal_code": "94102",
    "country_code": "US"
  },
  "building_type": "RESIDENTIAL",
  "device_ids": [32, 44, 44, 44],
  "create_application": true
}
```

**Required Fields:**

- `operation_type` (string): **Always required** - Must be either `"lookup"`, `"refresh"`, or `"override"`
  - `"lookup"`: Standard new incentive calculation (address is required)
  - `"refresh"`: Refresh existing calculation using cached utilities (address is optional)
  - `"override"`: Replace all customer devices with new ones, then refresh calculation using cached utilities (address is optional)
- `reference_id` (string): **Always required** - Unique identifier for the customer within your organization.
  - **Format & validation (RFC 3986 unreserved characters):**
    - **Length:** 3–256 characters
    - **Allowed characters:** `A–Z`, `a–z`, `0–9`, `.`, `_`, `~`, `-`
    - **Pattern:** `^[A-Za-z0-9._~-]{3,256}$`
  - **Impact:** Requests with invalid `reference_id` values (for example values containing `#`, `/`, spaces, or other reserved characters) will be rejected with a `400` error to prevent broken Connect URLs.
- `building_type` (string): **Required for `lookup` and `override` operations, optional for `refresh`** - Building type (e.g., "RESIDENTIAL", "MULTIFAMILY", "COMMERCIAL"). For `refresh` operations, if not provided, the previously stored building type for that customer is used.
- `device_ids` (array of numbers): **Required for `lookup` and `override` operations, optional for `refresh`** - Array of device IDs to associate with the customer. Can contain duplicates (e.g., `[32, 44, 44, 44]` creates 4 customer_device records). 
  - For `lookup`: Required - all device_ids are created on first call
  - For `override`: Required - replaces all existing devices with the new device_ids
  - For `refresh`: Optional - if not provided, uses all devices already associated with the customer. If provided, validates that all device_ids are already associated with the customer.
  
  Note: Utility lookups use **all unique device categories** from the `device_ids` array (or existing devices for refresh) (passed as an array to utility lookup functions) to find programs for all device types (e.g., if you have EV Chargers and Thermostats, it will look up programs for both categories).

**Conditionally Required Fields:**

**When `operation_type="lookup"`:**

- `address` (object): **Required** - Full address information
  - `street_1` (string): **Required**
  - `city` (string): **Required**
  - `state_or_province_code` (string): **Required**
  - `postal_code` (string): **Required**
  - `country_code` (string): **Required**
  - `street_2` (string): Optional address line 2

**When `operation_type="refresh"`:**

- `address` (object): **Optional** - If provided and differs from stored address, the customer's address will be updated
- `building_type` (string): **Optional** - If not provided, the previously stored building type for that customer is used

**Optional Fields:**

- `create_application` (boolean): If true, creates or updates application records for eligible programs

## Response

```json
{
  "utility": {
    "eiaid": 12345,
    "name": "Pacific Gas & Electric"
  },
  "possible_utilities": [
    {
      "eiaid": "12345",
      "name": "Pacific Gas & Electric"
    }
  ],
  "address": "123 Main St, San Francisco, CA 94102",
  "building_type": "single_family",
  "customer_id": 789,
  "programs_evaluated": 3,
  "incentives": {
    "total_incentive_amount": 5500,
    "total_eligible_combinations": 2,
    "by_program": [
      {
        "program_id": 101,
        "program_name": "Home Upgrade Program",
        "total_incentive": 3000,
        "eligible_combinations": 1,
        "device_tier_results": [
          {
            "device_id": 42,
            "device_name": "Heat Pump",
            "tier_id": 1,
            "tier_name": "Standard",
            "eligible": true,
            "incentive_amount": 3000,
            "calculation_details": "Base incentive for heat pump installation",
            "failed_requirements": [],
            "ignored_requirements": [],
            "completed_requirements": [
              "Income verification",
              "Building type check"
            ]
          }
        ]
      }
    ]
  },
  "connect_url": "https://connect.incentives.leap.energy/your-company/refId/external-ref-123",
  "reference_id": "external-ref-123"
}
```

## Security Features

### API Key Validation

- Validates API key format and authenticity
- Checks key expiration
- Verifies IP whitelist (if configured)
- Updates last_used_at timestamp
- Returns user and organization context

### Organization Requirements

- Your organization must have a company name configured (used to generate the Connect URL)
- API calls will fail with 400 error if organization company is not configured

### Organization Isolation

- Customers are automatically linked to your organization using the `reference_id` you provide
- You can only access customers associated with your organization
- Reference IDs are scoped per organization (the same reference_id can be used for different customers in different organizations)

### Customer Access Control

- The API verifies that the customer is associated with your organization
- Returns 400 error if the reference_id does not match your records
- You can only access customers that belong to your organization

## Behavior

### Operation Types

The function supports three operation types that determine customer lookup and utility resolution behavior:

#### 1. Lookup Operation (`operation_type="lookup"`)

**Purpose**: Create a new incentive calculation for a customer at a specific address

**Customer Lookup:**

1. Searches for an existing customer by your `reference_id` (within your organization)
2. If not found, creates a new customer record

**Utility Resolution:**

- Geocodes the address and finds utilities for the location
- Caches the primary utility and possible utilities list on the customer record
- Uses fresh data from utility lookup

**Required Fields**: Full address information is required

#### 2. Refresh Operation (`operation_type="refresh"`)

**Purpose**: Re-calculate incentives for an existing customer using cached utilities

**Customer Lookup:**

1. Searches for an existing customer by your `reference_id` (within your organization)
2. Returns 400 error if no customer is found with that reference_id
3. If address is provided and differs from the stored address, the customer's address is updated; cached utilities are still used (no geocoding)

**Device Handling:**

- **Without `device_ids`:** Uses all existing devices already associated with the customer. This allows refreshing with just `reference_id`.
- **With `device_ids`:** Validates that all provided `device_ids` already exist for the customer, then uses those devices. Rejects if any device_id is missing.

**Utility Resolution:**

- Uses cached utility data from the customer record
- Looks up programs for those utilities
- Much faster than lookup operation (no geocoding required)
- Falls back to full utility lookup if no cached data exists

**Required Fields**: Only `reference_id` is required. `address` and `building_type` are optional (uses stored customer data if not provided)

#### 3. Override Operation (`operation_type="override"`)

**Purpose**: Replace all customer devices with new ones, then refresh calculation using cached utilities

**Customer Lookup:**

1. Searches for an existing customer by your `reference_id` (within your organization)
2. Returns 400 error if no customer is found with that reference_id
3. If address is provided and differs from the stored address, the customer's address is updated; cached utilities are still used (no geocoding)

**Device Handling:**

- **Replaces all existing devices for the customer** with the new `device_ids` you provide
- Associates the customer with the devices in the `device_ids` array (duplicates are allowed, e.g. multiple units of the same device)
- Allows replacing devices completely, unlike refresh which requires existing devices

**Utility Resolution:**

- Uses cached utility data from the customer record
- Looks up programs for those utilities
- Much faster than lookup operation (no geocoding required)
- Falls back to full utility lookup if no cached data exists

**Required Fields**: Address is optional (uses stored customer address if not provided)

**Use Case**: Use when you need to completely replace a customer's device list (e.g., customer changed their equipment)

### Customer Creation

If no customer exists (lookup operation only):

1. Validates building_type (RESIDENTIAL, MULTIFAMILY, MANUFACTURED_HOME, COMMERCIAL)
2. Creates a new customer record with the provided address and building type
3. Links the customer to your organization using the `reference_id` you provided
4. Proceeds with incentive calculation

### Existing Customer

If customer exists:

1. Verifies the customer is associated with your organization
2. Validates that the `reference_id` matches the one you previously used for this customer
   - Returns 400 error if reference_id does not match
3. If the customer exists but was not yet linked to your organization, creates the link with your `reference_id`
4. Proceeds with incentive calculation

### Device Association

**For `lookup` and `refresh` operations:**
- **First call (customer has no devices yet):** Associates all `device_ids` in the array with the customer, including duplicates. For example, `device_ids: [32, 44, 44, 44]` creates one association for device 32 and three for device 44.
- **Subsequent calls:** Validates that all `device_ids` in the array are already associated with the customer. If any device_id is missing, the request is rejected with a 400 error.

**For `refresh` operation:**
- **Without `device_ids`:** Uses all devices already associated with the customer. This allows refreshing with just `reference_id`.
- **With `device_ids`:** Validates that all provided `device_ids` already exist for the customer, then uses those devices.

**For `override` operation:**
- **Always:** Deletes all existing `customer_device` records for the customer, then creates new records from the `device_ids` array (including duplicates).
- This allows completely replacing a customer's device list without validation errors.

**General:**
- Each `customer_device` record uses quantity of 1 by default.
- **Utility Program Lookups:** The function extracts **unique device categories** from all `device_ids` and passes them as an array to utility lookup functions. For example, if `device_ids: [32, 44, 44, 45]` where device 32 has category 2, device 44 has category 2, and device 45 has category 4, it will pass `device_category_id: [2, 4]` to the utility lookup functions, which will return programs for both categories. This ensures you get programs for all device types (e.g., EV Chargers, Thermostats, Heat Pumps, etc.).

### Application Creation

When `create_application` is set to `true`:

1. Uses all devices associated with the customer to get the complete list of device IDs
2. For each program with an incentive calculation:
   - Checks if an application already exists for the (customer_id, program_id) combination
   - **If no application exists:**
     - Creates new application record with:
       - `program_id`: The program being applied to
       - `customer_id`: The customer ID
       - `customer_device_id`: Array of all customer device IDs (or null if empty)
       - `organization_id`: The API key's organization ID
       - `status`: Defaults to 'new'
   - **If application already exists:**
     - Updates the existing application's `customer_device_id` array with the latest list
     - This ensures applications stay in sync with current customer devices
3. Applications are only created/updated if the customer is eligible (has eligible combinations or incentive amount > 0)

**Connect URL Generation:**

When `create_application` is `true`, the response includes a `connect_url` field formatted as:

```
https://connect.incentives.leap.energy/{company}/refId/{reference_id}
```

Where `{company}` is the organization's company field. This URL can be used to direct customers to complete their applications.

## Error Responses

### Authentication Errors

```json
// 400 - Both authentication headers provided
{
  "error": "Provide either x-api-key OR Authorization, not both."
}

// 401 - Missing authentication
{
  "error": "Missing x-api-key header"
}

// 403 - Invalid API key
{
  "error": "Invalid API key"
}

// 403 - Expired key
{
  "error": "API key has expired"
}

// 403 - IP not allowed
{
  "error": "IP address not allowed"
}
```

### Validation Errors

```json
// 400 - Invalid JSON
{
  "error": "Invalid or empty JSON body"
}

// 400 - Missing required fields
{
  "error": "Missing required field: operation_type or reference_id"
}

// 400 - Invalid operation_type
{
  "error": "Invalid operation_type. Must be either \"lookup\", \"refresh\", or \"override\""
}

// 400 - Invalid reference_id format
{
  "error": "Invalid reference_id. Must be 3-256 characters and contain only RFC 3986 unreserved characters (A-Za-z0-9._~-)"
}

// 400 - Missing address fields for lookup operation
{
  "error": "For lookup operation, address fields are required: street_1, city, state_or_province_code, postal_code, country_code, building_type"
}

// 400 - Organization company not configured
{
  "error": "Organization company should be set for your organization. Please contact Leap to set this up"
}

// 400 - Invalid building type
{
  "error": "Invalid building_type: single_family. Must be one of: RESIDENTIAL, MULTIFAMILY, MANUFACTURED_HOME, COMMERCIAL"
}

// 400 - Reference ID mismatch
{
  "error": "Reference ID mismatch. The customer is linked to this organization with a different reference_id. Expected: old-ref-123, Received: new-ref-456"
}
```

### Server Errors

```json
// 500 - Internal error
{
  "error": "Internal server error"
}

// 404 - No utility found
{
  "error": "Program lookup failed - no utility found"
}
```

## Usage Examples

```bash
# Set your API key
API_KEY="leap_live_abc123..."

# Example 1: Lookup operation - New incentive calculation with address
# This will geocode the address, find utilities, and calculate incentives
curl -X POST 'https://your-project.supabase.co/functions/v1/incentives' \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation_type": "lookup",
    "reference_id": "external-ref-123",
    "address": {
      "street_1": "123 Main St",
      "city": "San Francisco",
      "state_or_province_code": "CA",
      "postal_code": "94102",
      "country_code": "US"
    },
    "building_type": "RESIDENTIAL",
    "device_ids": [42],
    "create_application": true
  }'

# Example 2: Refresh operation - Re-calculate using cached utilities (minimal fields needed)
# Much faster than lookup - uses cached utility data, existing devices, and stored building_type
curl -X POST 'https://your-project.supabase.co/functions/v1/incentives' \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation_type": "refresh",
    "reference_id": "external-ref-123",
    "create_application": true
  }'

# Example 3: Refresh with address update and optional device_ids validation
# Updates customer address while using cached utilities (no geocoding)
# If device_ids provided, validates they exist; otherwise uses all existing devices
curl -X POST 'https://your-project.supabase.co/functions/v1/incentives' \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation_type": "refresh",
    "reference_id": "external-ref-123",
    "address": {
      "street_1": "456 Oak Ave",
      "city": "San Francisco",
      "state_or_province_code": "CA",
      "postal_code": "94103",
      "country_code": "US"
    },
    "building_type": "RESIDENTIAL",
    "device_ids": [42],
    "create_application": false
  }'

# Example 4: Override operation - Replace all customer devices
# Deletes all existing devices and creates new ones from device_ids array
curl -X POST 'https://your-project.supabase.co/functions/v1/incentives' \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation_type": "override",
    "reference_id": "external-ref-123",
    "building_type": "RESIDENTIAL",
    "device_ids": [55, 66, 77],
    "create_application": false
  }'
```

**When to use each operation type:**

- **`lookup`**: First-time customer, new address, or when you need fresh utility data
- **`refresh`**: Returning customer with same address and same devices, faster performance by using cached utilities
- **`override`**: Returning customer who changed their devices - replaces all existing devices with new ones, then refreshes calculation

## Related Functions

- **api-key-manager**: Create and manage API keys
- **utility-programs-lookup**: Find utility programs for an address (used by lookup operation)
- **programs-for-utilities**: Get programs for a list of utilities (used by refresh operation)
- **incentive calculation functions**: Calculate incentives for specific programs

## API Call Logging

All successful API calls are automatically logged with the following information:

- `customer_id`: The customer ID associated with the request
- `organization_id`: The organization making the request
- `operation_type`: Either "lookup", "refresh", or "override"
- `response_data`: Full JSON response returned to the client
- `created_at`: Timestamp of the API call

This logging helps with:

- Debugging customer issues
- Tracking API usage patterns
- Auditing customer interactions
- Performance monitoring

Note: Logging failures do not cause the API request to fail - they are logged but the response is still returned.

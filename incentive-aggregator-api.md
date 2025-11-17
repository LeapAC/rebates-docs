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

**Required:** API key in `x-api-key` header

```
x-api-key: leap_live_<your_api_key>
```

To generate an API key:

1. Login to your account (get JWT token)
2. Call the `/api-key-manager` endpoint with your JWT
3. Save the returned API key securely

See [API Key Manager documentation](../api-key-manager/README.md) for details.

## Endpoint

**POST /incentives**

## Request

**Headers:**

```
x-api-key: leap_live_abc123...
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
  "building_type": "single_family",
  "device_id": 42,
  "create_application": true
}
```

**Required Fields:**

- `operation_type` (string): **Always required** - Must be either `"lookup"` or `"refresh"`
  - `"lookup"`: Standard new incentive calculation (address is required)
  - `"refresh"`: Refresh existing calculation using cached utilities (address is optional)
- `reference_id` (string): **Always required** - Unique identifier for the customer within your organization
- `building_type` (string): Always required (e.g., "single_family", "multifamily", "commercial")
- `device_id` (number): Always required

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

- Organization must have a `company` field set in the database
- This field is used to generate the Connect URL
- API calls will fail with 400 error if organization company is not configured

### Organization Isolation

- Customers are automatically linked to the API key user's organization via `customer_organizations` table
- Users can only access customers within their organization
- Enforced by Row Level Security (RLS) policies
- Cross-organization access is prevented
- Reference IDs are scoped to organizations (same reference_id can exist in different organizations)

### Customer Access Control

- Function verifies the customer is linked to the user's organization
- Returns 400 error if reference_id mismatch is detected
- Prevents unauthorized access to customer data across organizations

## Behavior

### Operation Types

The function supports two operation types that determine customer lookup and utility resolution behavior:

#### 1. Lookup Operation (`operation_type="lookup"`)

**Purpose**: Create a new incentive calculation for a customer at a specific address

**Customer Lookup:**

1. Searches for existing customer by full address match
   - Matches on: address_line1, address_line2, city, state, zip_code, country_code
2. If found, uses existing customer
3. If not found, creates new customer record

**Utility Resolution:**

- Calls `utility-programs-lookup` edge function to geocode address and find utilities
- Caches the primary utility and possible utilities list on the customer record
- Uses fresh data from utility lookup

**Required Fields**: Full address information is required

#### 2. Refresh Operation (`operation_type="refresh"`)

**Purpose**: Re-calculate incentives for an existing customer using cached utilities

**Customer Lookup:**

1. Searches for customer by `reference_id` + `organization_id` in `customer_organizations` table
2. Returns 400 error if customer not found with that reference_id
3. If address is provided in request and differs from stored address:
   - Updates customer's address in database
   - Still uses cached utilities (no geocoding)

**Utility Resolution:**

- Reads cached `eiaid` and `possible_utilities` from customer record
- Calls `programs-for-utilities` edge function with cached utility list
- Much faster than lookup operation (no geocoding required)
- Falls back to standard utility lookup if no cached utilities exist

**Required Fields**: Address is optional (uses stored customer address if not provided)

### Customer Creation

If no customer exists (lookup operation only):

1. Validates building_type against `building_types` table
2. Creates new customer record with provided address and building_type_id
3. Automatically links customer to user's organization via `customer_organizations` table with the provided `reference_id`
4. Logs the customer ID and organization ID

### Existing Customer

If customer exists:

1. Verifies customer is linked to user's organization via `customer_organizations` table
2. Validates that the `reference_id` matches the stored reference_id for this organization
   - Returns 400 error if reference_id mismatch detected
3. Creates organization link if customer exists but not linked to this organization
4. Proceeds with incentive calculation

### Device Association

- Checks if customer already has the specified device
- Creates customer_device record if not exists
- Uses quantity of 1 by default

### Application Creation

When `create_application` is set to `true`:

1. Queries all `customer_devices` for the customer to get the complete list of device IDs
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
3. Applications are created/updated even if the program returns no eligible incentives

**Connect URL Generation:**

When `create_application` is `true`, the response includes a `connect_url` field formatted as:

```
https://connect.incentives.leap.energy/{company}/refId/{reference_id}
```

Where `{company}` is the organization's company field. This URL can be used to direct customers to complete their applications.

## Error Responses

### Authentication Errors

```json
// 401 - Missing API key
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
  "error": "Invalid operation_type. Must be either \"lookup\" or \"refresh\""
}

// 400 - Missing address fields for lookup operation
{
  "error": "For lookup operation, address fields are required: street_1, city, state_or_province_code, postal_code, country_code, building_type, device_id"
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
curl -X POST 'https://api.incentives.leap.energy/alpha/incentives' \
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
    "building_type": "single_family",
    "device_id": 42,
    "create_application": true
  }'

# Example 2: Refresh operation - Re-calculate using cached utilities
# Much faster than lookup - uses cached utility data, no geocoding
curl -X POST 'https://api.incentives.leap.energy/alpha/incentives' \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation_type": "refresh",
    "reference_id": "external-ref-123",
    "building_type": "single_family",
    "device_id": 42,
    "create_application": true
  }'

# Example 3: Refresh with address update
# Updates customer address while using cached utilities (no geocoding)
curl -X POST 'https://api.incentives.leap.energy/alpha/incentives' \
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
    "building_type": "single_family",
    "device_id": 42,
    "create_application": false
  }'
```

**When to use each operation type:**

- **`lookup`**: First-time customer, new address, or when you need fresh utility data
- **`refresh`**: Returning customer with same address, faster performance by using cached utilities

## Related Functions

- **api-key-manager**: Create and manage API keys
- **utility-programs-lookup**: Find utility programs for an address (used by lookup operation)
- **programs-for-utilities**: Get programs for a list of utilities (used by refresh operation)
- **incentive calculation functions**: Calculate incentives for specific programs

## API Call Logging

All successful API calls are automatically logged to the `incentive_api_logs` table with the following information:

- `customer_id`: The customer ID associated with the request
- `organization_id`: The organization making the request
- `operation_type`: Either "lookup" or "refresh"
- `response_data`: Full JSON response returned to the client
- `created_at`: Timestamp of the API call

This logging helps with:

- Debugging customer issues
- Tracking API usage patterns
- Auditing customer interactions
- Performance monitoring

Note: Logging failures do not cause the API request to fail - they are logged but the response is still returned.

## Database Tables

### Tables Used:

- `api_keys` - API key validation
- `organizations` - Organization context and company field
- `customers` - Customer records (stores cached eiaid and possible_utilities)
- `customer_organizations` - Customer-organization links with reference_id (many-to-many)
- `customer_devices` - Customer device associations
- `building_types` - Valid building types (RESIDENTIAL, MULTIFAMILY, MANUFACTURED_HOME, COMMERCIAL)
- `applications` - Application records (created/updated if create_application is true)
- `incentive_api_logs` - API call logging for auditing and debugging

### Key Fields:

**customers table:**

- `eiaid` (string): Cached primary utility ID
- `possible_utilities` (text[]): Cached list of possible utility IDs for this address

**customer_organizations table:**

- Composite key: `(customer_id, organization_id, reference_id)`
- Allows same customer to be linked to multiple organizations with different reference_ids

### RLS Policies:

All queries respect Row Level Security policies that enforce organization-level isolation.


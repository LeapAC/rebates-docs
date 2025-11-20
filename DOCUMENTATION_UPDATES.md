# Documentation Updates - November 17, 2025

## Summary

Updated the Leap Incentives API documentation to reflect the complete organization API key functionality and incentive aggregator endpoint. All documentation is now consistent with the actual API implementation.

## Files Added

### 1. `organization-api.md`
- **Location**: Root directory
- **Purpose**: Comprehensive reference documentation for all organization API key endpoints
- **Contents**: Complete specification including:
  - Authentication details
  - All 8 endpoints with request/response examples
  - Query parameters, path parameters, and request bodies
  - Error responses and status codes
  - Usage notes and best practices

### 2. `incentive-aggregator-api.md`
- **Location**: Root directory
- **Purpose**: Complete reference documentation for the incentive aggregator endpoint
- **Contents**: Comprehensive specification including:
  - Two operation types (lookup vs refresh)
  - Customer creation and linking behavior
  - Security features and organization isolation
  - Application creation workflow
  - API call logging
  - Database tables and RLS policies
  - Usage examples for both operation types

### 3. `api-reference/endpoint/list-attachments.mdx`
- **Endpoint**: `GET /applications/attachments`
- **Purpose**: List attachments for applications
- **Features**: 
  - Single application mode (`application_id`)
  - Bulk mode (`application_ids`)
  - Optional attachment type filtering

### 4. `api-reference/endpoint/download-attachment.mdx`
- **Endpoint**: `GET /applications/attachments/{id}/download`
- **Purpose**: Get signed download URL for attachments
- **Features**: 1-hour valid signed URLs

### 5. `api-reference/endpoint/delete-attachment.mdx`
- **Endpoint**: `DELETE /applications/attachments/{id}`
- **Purpose**: Delete attachments from storage and database
- **Features**: Permanent deletion with proper warnings

## Files Updated

### 1. `api-reference/endpoint/check-incentives.mdx`
**Changes:**
- Added operation_type parameter (lookup vs refresh)
- Documented two operation modes with different behaviors
- Updated request examples for both lookup and refresh operations
- Updated base URL to production URL
- Updated API key examples to use `leap_live_...` format
- Added comprehensive error responses for all scenarios
- Added Security & Organization Isolation section
- Added performance tips for using refresh operation
- Updated response examples with more detail
- Documented customer creation and linking behavior
- Added conditional requirements based on operation type

### 2. `api-reference/endpoint/search-applications.mdx`
**Changes:**
- Added `refId` query parameter documentation
- Updated base URL to production URL (`api.incentives.leap.energy/alpha`)
- Updated API key examples to use `leap_live_...` format
- Added example request with refId filtering

### 3. `api-reference/endpoint/get-application.mdx`
**Changes:**
- Added Query Parameters section with `refId` parameter
- Updated base URL to production URL
- Updated API key examples to use `leap_live_...` format
- Added example request with refId verification

### 4. `api-reference/endpoint/update-application.mdx`
**Changes:**
- Added important note about organization key restrictions
- Clarified that org keys must use path-based endpoints (`/applications/{application_id}`)
- Documented that query parameter-based endpoints are for admin keys only

### 5. `api-reference/endpoint/attachments.mdx`
**Changes:**
- Updated description to clarify it covers the upload process (create URL + commit)
- Clarified `makePublic` parameter behavior in response
- Updated example URLs to mask full hostnames
- Added note about file_url format differences

### 6. `docs.json`
**Changes:**
- Added `api-reference/overview` to navigation (first item in API Reference)
- Reorganized attachments endpoints into a nested "Attachments" group
- Added three new attachment endpoint pages to navigation

## Documentation Structure

The API Reference section now has the following structure:

```
API Reference
├── API Overview (NEW)
├── Check Incentives
├── Search Applications (UPDATED)
├── Get Application (UPDATED)
├── Update Application (UPDATED)
└── Attachments
    ├── Upload Attachments (UPDATED)
    ├── List Attachments (NEW)
    ├── Download Attachment (NEW)
    └── Delete Attachment (NEW)
```

## Key Features Documented

### Organization API Keys
- Automatic organization scoping
- `leap_live_` prefix convention
- Permission restrictions
- Path parameter requirements for updates

### Reference ID (refId)
- Customer filtering and verification
- Organization-customer relationship validation
- Use cases and examples

### Attachment Management
- Complete upload workflow (create URL → upload file → commit)
- Bulk listing with `application_ids`
- Signed download URLs with expiration
- Permanent deletion capabilities

### Error Handling
- Consistent error response format
- Common error codes documented
- HTTP status codes for all scenarios
- Descriptive error messages

### API Features
- Pagination support (limit + page_token)
- Dry run mode for updates
- Status transition validation
- Organization verification for all operations

## Testing Recommendations

1. Verify all example curl commands work with actual API keys
2. Test refId parameter with various customer scenarios
3. Confirm attachment bulk operations with multiple application IDs
4. Validate error responses match documented formats
5. Test pagination with various limit values

## Next Steps

1. Update OpenAPI specification (`api-reference/openapi.json`) if needed
2. Consider adding more code examples in different languages
3. Add interactive API playground if Mintlify supports it
4. Create quickstart guide specifically for organization API keys
5. Add troubleshooting section for common issues

## Notes

- All documentation follows the actual API implementation
- Examples use realistic data and proper URL formats
- Consistent formatting across all endpoint documentation
- Clear separation between organization and admin key capabilities
- Comprehensive error response documentation for better debugging


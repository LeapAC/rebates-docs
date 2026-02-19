# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Mintlify documentation site that serves as a starter kit for building customizable documentation. The repository uses MDX files for content and is configured via `docs.json`.

## Development Commands

### Local Development
```bash
# Install Mintlify CLI (requires Node.js v19+)
npm i -g mint

# Start local development server (default port 3000)
mint dev

# Use custom port
mint dev --port 3333

# Update CLI to latest version
npm mint update

# Validate links in documentation
mint broken-links
```

## Repository Structure

The documentation is organized into the following key directories:

- `/api-reference/` - API documentation examples with OpenAPI integration
- `/essentials/` - Core documentation guides (markdown, code samples, images, navigation)
- `/ai-tools/` - Documentation for AI development tools integration
- `/snippets/` - Reusable MDX content snippets
- `/images/` - Image assets for documentation
- `/logo/` - Logo SVG files (light and dark variants)

Key configuration file:
- `docs.json` - Main configuration for navigation, theming, and site structure

## Content Architecture

### Navigation Structure
The site uses a flat left-nav with groups defined in `docs.json`:
- **Getting Started**: Introduction, Quickstart
- **API Reference**: API Guide, endpoint pages, subgroups (Attachments, Batch Lookups, Webhook Config)
- **Guides**: Incentives, Applications, Claimed Fields, Program Roadmap
- Navigation is configured via the `navigation.groups` array in `docs.json`
- Do NOT use `tabs` — the site uses flat groups in the left sidebar

### MDX Components
Documentation pages use MDX format with built-in components:
- `<Card>` - Feature cards with icons and links
- `<Columns>` - Column layouts
- `<AccordionGroup>` and `<Accordion>` - Collapsible content sections
- `<Steps>` and `<Step>` - Step-by-step tutorials
- `<Tip>`, `<Note>`, `<Info>` - Callout blocks
- `<Frame>` - Image containers

### Theming
Site theming is configured in `docs.json`:
- Colors are defined under the `colors` object (primary, light, dark)
- Logo variants for light/dark mode in `/logo/`
- Theme property set to "mint"

## Deployment

The site uses GitHub integration for automatic deployments:
- Install Mintlify GitHub app from dashboard for auto-deployment
- Changes pushed to the default branch are automatically deployed
- No manual deployment commands needed

## Working with Content

When creating or editing documentation:
1. All content files should be in MDX format
2. Use frontmatter for page metadata (title, description)
3. Reusable content should be placed in `/snippets/`
4. API documentation can be auto-generated from OpenAPI specs (`/api-reference/openapi.json`)

# Working relationship
- You can push back on ideas-this can lead to better documentation. Cite sources and explain your reasoning when you do so
- ALWAYS ask for clarification rather than making assumptions
- NEVER lie, guess, or make up information

## Project context
- Format: MDX files with YAML frontmatter
- Config: docs.json for navigation, theme, settings
- Components: Mintlify components

## Content strategy
- Document just enough for user success - not too much, not too little
- Prioritize accuracy and usability of information
- Make content evergreen when possible
- Search for existing information before adding new content. Avoid duplication unless it is done for a strategic reason
- Check existing patterns for consistency
- Start by making the smallest reasonable changes

## Frontmatter requirements for pages
- title: Clear, descriptive page title
- description: Concise summary for SEO/navigation

## Writing standards
- Second-person voice ("you")
- Prerequisites at start of procedural content
- Test all code examples before publishing
- Match style and formatting of existing pages
- Include both basic and advanced use cases
- Language tags on all code blocks
- Alt text on all images
- Relative paths for internal links

## API Documentation Standards

### OpenAPI Integration
- **DO NOT duplicate** information that's already defined in the OpenAPI spec (`/api-reference/openapi.json`)
- OpenAPI automatically generates: request/response schemas, parameters, code examples, error responses
- API reference MDX files should only contain: frontmatter with `openapi` reference, brief overview, unique tips/warnings, links to guides
- Keep API reference pages minimal (15-30 lines) - let Mintlify auto-generate the technical details

### OpenAPI Spec Maintenance (`api-reference/openapi.json`)
When editing the OpenAPI spec, follow these rules to avoid breaking the API reference pages:

**JSON structure:**
- All schemas must be inside `components.schemas` (not direct children of `components`)
- All reusable responses must be inside `components.responses`
- Watch for extra closing braces `}` that prematurely close `schemas` or `responses` — JSON will still be valid but `$ref` paths will silently break

**After any spec edit, validate `$ref` resolution:**
```bash
python3 -c "
import json, re
spec = json.load(open('api-reference/openapi.json'))
content = json.dumps(spec)
refs = re.findall(r'\"\\\$ref\"\s*:\s*\"([^\"]+)\"', content)
for ref in set(refs):
    if ref.startswith('#/'):
        parts = ref.replace('#/', '').split('/')
        obj = spec
        try:
            for p in parts:
                obj = obj[p]
        except (KeyError, TypeError):
            print(f'BROKEN: {ref}')
print('Done — no output above means all refs resolve.')
"
```

**What breaks when `$ref`s don't resolve:**
- API endpoint pages lose rich request/response schema rendering
- Try-it playground stops working
- Code samples panel disappears
- Pages still render but show only the MDX content, not auto-generated API details

### Mintlify + OpenAPI Configuration (docs.json)
These rules prevent common Mintlify misconfigurations:

- **Do NOT add `"openapi"` at the top level of `docs.json`** — Mintlify interprets docs.json itself as an OpenAPI file and throws validation errors
- **Do NOT use `tabs` navigation with an `openapi` property** — this auto-generates nav entries for every operation in the spec, creating duplicate sidebar entries alongside the curated MDX pages
- **Mintlify auto-discovers `api-reference/openapi.json`** — no explicit config needed in docs.json when using a single spec file
- MDX endpoint files use short-form frontmatter: `openapi: 'POST /incentives'` (no file path needed with single spec)
- If you ever need multiple spec files, include the path in frontmatter: `openapi: 'path/to/spec.json POST /endpoint'`

### Organization Scoping
- **DO NOT repeatedly mention** organization scoping in API documentation
- For external API users, organization scoping is implicit and assumed
- Avoid phrases like "must belong to your organization" or "automatically scoped to your organization"
- Exception: Include organization scoping details in the comprehensive API guide for context, but not on individual endpoint pages

### Internal Implementation Details (Do Not Expose)
The following technical details should NOT be included in partner-facing documentation:

**API Key Types:**
- Test keys (`leap_test_...`): For development and testing
- Live keys (`leap_live_...`): For production use

**Security Implementation:**
- Row Level Security (RLS): Database policies ensure secure data access
- All API operations are automatically scoped to organizations via RLS policies
- API calls are logged in `incentive_api_logs` table for auditing

**Rationale:** Partners don't need to know about internal security mechanisms or key naming conventions. Focus documentation on what they need to do (use API keys), not how the system works internally.

## Visual Verification with agent-browser

After making changes, verify the site renders correctly using agent-browser. Use port 3333 and `/tmp/` for screenshots. Always navigate directly to URLs — `find text` clicks can be flaky with Mintlify's SPA routing.

```bash
# 1. Start dev server (background, takes ~60-90 seconds)
# Kill old server first if needed: lsof -ti:3333 | xargs kill -9
npx mint dev --port 3333

# 2. Navigate directly to the page
agent-browser open http://localhost:3333/path-to-page

# 3. Screenshot to /tmp/ (no approval needed)
agent-browser screenshot /tmp/verify.png

# 4. Read screenshot to inspect visually
# Use the Read tool on /tmp/verify.png

# 5. Close when done
agent-browser close
```

**Key pages to check after changes:**
- Homepage: `http://localhost:3333/`
- API endpoint (rich schemas + Try it): `http://localhost:3333/api-reference/endpoint/check-incentives`
- Batch endpoint: `http://localhost:3333/api-reference/endpoint/batch-create`
- Guides: `http://localhost:3333/incentives-guide`

**What to verify on API endpoint pages:**
- Try-it button is visible next to the method badge (e.g., `POST /incentives [Try it]`)
- Right panel shows code samples (cURL, Python, JavaScript)
- Response section shows status code tabs (200, 400, etc.) with example data
- Left sidebar shows flat navigation with no duplicate endpoint sections
- If any of these are missing, the OpenAPI spec likely has broken `$ref` references

## Git workflow
- Ask how to handle uncommitted changes before starting
- Create a new branch when no clear branch exists for changes
- Commit frequently throughout development
- NEVER skip or disable pre-commit hooks

## Do not
- Skip frontmatter on any MDX file
- Use absolute URLs for internal links
- Include untested code examples
- Make assumptions - always ask for clarification
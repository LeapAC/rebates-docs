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
The site uses a tabbed navigation system defined in `docs.json`:
- **Guides tab**: Getting started, customization, writing content, AI tools
- **API reference tab**: API documentation and endpoint examples
- Navigation is configured via the `navigation` object in `docs.json`

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

### Organization Scoping
- **DO NOT repeatedly mention** organization scoping in API documentation
- For external API users, organization scoping is implicit and assumed
- Avoid phrases like "must belong to your organization" or "automatically scoped to your organization"
- Exception: Include organization scoping details in the comprehensive API guide for context, but not on individual endpoint pages

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
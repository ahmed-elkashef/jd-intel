# Source safety fork

This MIT fork builds on [jd-intel by Prashant R](https://github.com/prPMDev/jd-intel), upstream commit `c37a6edeb1140d2418e07928dedd6537bc4bf12d` (library 0.12.0, MCP 0.13.0). The original copyright, license, history and author credit are preserved. Maintenance of this fork is by Ahmed Elkashef.

## Changes

- Greenhouse `updated_at` is kept as edit metadata. It never substitutes for a missing original `first_published` timestamp.
- Workday keeps the initial list total when later pages report zero, as already fixed upstream. This fork also stops a repeated offset page, deduplicates external paths and reports partial list retrieval through `scan.capped`.
- Unfiltered Workday acquisition with `order: "board"` hydrates the requested offset slice, at most 100 descriptions per call. It can continue beyond row 100. Malformed first-page lists raise an error; malformed later lists preserve the captured prefix as incomplete.
- Workday calendar dates and relative labels remain raw evidence. They do not become invented UTC midnight or a timestamp derived from the current clock.
- Personio keeps every nested description section, schedule and employment type, as already implemented upstream. This fork requests the board's default language: forcing English can silently return positions with empty descriptions. Empty source descriptions are marked missing. It also keeps raw `createdAt` and only exposes an original instant when the source provides a valid timestamp with its timezone.
- Lever keeps the overview, all requirements and responsibility lists, additional text and all native locations, as already fixed upstream.
- A recency filter retains rows explicitly marked with an unresolved original date. Retention means the date needs review; it does not certify that the posting is recent or inside a frozen interval.
- Recruitee `created_at` remains provider creation evidence and never fills a missing publication date. Missing, invalid and timezone-free `published_at` values remain unresolved, with their original values preserved.
- The MCP dependency points at this checkout, so running the fork's server uses the fork's adapters.
- The MCP lockfile uses compatible patched dependencies. The release verification runs `npm audit` in addition to the test suites.

All new regression fixtures are synthetic. No personal profiles, private sourcing captures, credentials or employer packages are included.

## Run the fork's MCP server

Node.js 18 or later is required.

```bash
git clone https://github.com/ahmed-elkashef/jd-intel.git
cd jd-intel
npm install --prefix mcp
node mcp/server.js
```

Add this stdio server to your client's MCP configuration, replacing the path with your own checkout path:

```json
{
  "mcpServers": {
    "jd-intel": {
      "command": "node",
      "args": ["/absolute/path/jd-intel/mcp/server.js"]
    }
  }
}
```

This fork is distributed through GitHub. `npx jd-intel-mcp` and the upstream MCPB download install upstream, not this fork. No upstream npm namespace or MCP Registry identity is republished by this fork.

The upstream Registry publication manifest is omitted from this fork. The inherited npm publishing workflow is restricted to the upstream repository.

## Verification

```bash
npm test
npm test --prefix mcp
```

The adapter regression tests cover a 41-row Workday list with later totals of zero and a beyond-end reset, 250-row bounded board pagination, unknown-total resets, duplicate rows, partial HTTP failures, malformed lists, date provenance and full nested description preservation. MCP regressions read a synthetic 205-row board past row 100 and verify that token-budget cuts preserve the delivered continuation offset. The inherited suites also verify response sizes, pagination and cap reporting.

## Retrieval limits

These are source adapters, not a census of any national job market or an assessment of candidate fit. A registry match is an employer routing locator, not geographic eligibility.

Workday lists at most 100 pages of 20 postings and hydrates at most 100 details per call. For one Workday board, omit all filters and use `order: "board"` to acquire consecutive full-description pages beyond row 100. The library exposes `pagination`; MCP exposes `metadata.source_pagination`. With a complete current native list, unfiltered counts can be exact even though `scan.capped` indicates that descriptions outside the requested page were not read. A partial list keeps `counts_exact: false`. Every list is a moving snapshot, so deduplicate by native source ID or external path and preserve the original interval on resume.

Workday requests with newest ordering or title, description, location or recency filters retain the inherited prefix scan. Those offsets refer to matches after filtering and sorting; without reading unseen descriptions or dates, the adapter cannot safely reinterpret them as native board offsets. Such requests remain capped and are not a full-board inventory. SmartRecruiters retains its own per-call detail budget.

The MCP returns whole jobs within its `limit` and `max_tokens` budget. Continue with `metadata.next_offset`; `metadata.source_pagination.next_offset` matches the delivered cursor after a token-budget cut. Do not infer exhaustion from a short response alone. An exhausted current list does not establish complete historical supply, and a list cap or failure remains incomplete.

Do not use title, skill, location substrings or a recency label as proof of eligibility. A frozen publication interval requires a verified original timestamp and timezone. Edited, observed, relative, calendar-only and missing dates require separate treatment. Country restrictions, employment status and mandatory credentials require their own source evidence.

Use only source routes permitted by the provider. This fork does not bypass authentication, access controls, provider policies or rate limits. It does not apply, bid or contact anyone.

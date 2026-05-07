---
name: dev-browser
description: "Use Chrome DevTools MCP for browser-based verification, UI regression checks, screenshots, console/network inspection, and quick performance traces. Trigger when verifying frontend changes in a live browser, capturing evidence, or debugging client-side issues."
license: MIT
compatibility: opencode
---

# Dev Browser (Chrome DevTools MCP)

Use the Chrome DevTools MCP tools to verify UI changes, capture evidence, and inspect console/network state.

## When to use
- Verify frontend changes in a live browser
- Capture viewport or full-page screenshots
- Inspect console errors/warnings
- Inspect network requests and responses
- Run quick performance traces

## Preconditions
- Chrome is installed and reachable by the MCP server
- MCP is configured in `~/.config/opencode/opencode.json`
- Prefer headless mode for automation
- Avoid sensitive data in the browser session

## Standard workflow
1. Discover or select a page:
   - `list_pages`
   - `select_page` (if needed)
2. Navigate:
   - `new_page` or `navigate_page`
3. Wait for stability:
   - `wait_for` (use a key selector or page-ready signal)
4. Capture evidence:
   - `take_screenshot` (set `fullPage: true` for full page)
   - `take_snapshot` for DOM snapshot
5. Debug:
   - `list_console_messages`
   - `list_network_requests` → `get_network_request` for details

## Performance (optional)
- `performance_start_trace`
- Interact or wait for the target state
- `performance_stop_trace`
- `performance_analyze_insight`

## Output expectations
- Provide screenshot path or attached image
- Summarize console and network findings
- Note any errors and next checks

## Quick example
Use the dev-browser skill to verify `/en/games/...` renders correctly, capture a full-page screenshot, and confirm there are no console errors.

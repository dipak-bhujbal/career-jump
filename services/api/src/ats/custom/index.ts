/**
 * Custom adapter registry. Each import below self-registers via
 * `registerAdapter` in shared/types.ts. The order doesn't matter — registry
 * dispatch goes by id, not import order.
 *
 * Two kinds of customs:
 *   1) **Generic fallbacks** (id `custom-jsonld`, `custom-sitemap`) — scrape
 *      structured data from any career page, no per-company knowledge.
 *      Routed when registry's ats label is "Custom".
 *   2) **Per-company adapters** (id `custom:<key>`) — bespoke API/HTML.
 *      Override for that one company. See _README.md.
 */

// Generic fallbacks — register first
import "./jsonld";
import "./sitemap";

// Per-company adapters
import "./tesla";
import "./apple";
import "./berkshire";

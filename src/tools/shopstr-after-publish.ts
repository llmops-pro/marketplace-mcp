// After-publish hook factory: POST a signed event to Shopstr's cache so the
// storefront UI surfaces it. Best-effort; failures never roll back the relay
// publish.

import type { Config } from "../config.js";
import { postEventToShopstrCache } from "../lib/cache-event.js";
import type { AfterPublishHook } from "./evaluate-and-publish.js";

export function makeShopstrCacheHook(config: Config): AfterPublishHook {
  return async (event) => {
    if (!config.SHOPSTR_CACHE_ENABLED) {
      return {
        shopstr_cache: {
          attempted: false,
          reason: "SHOPSTR_CACHE_ENABLED is not true",
        },
      };
    }
    const res = await postEventToShopstrCache(config.SHOPSTR_CACHE_URL, event);
    return {
      shopstr_cache: {
        attempted: true,
        url: config.SHOPSTR_CACHE_URL,
        ok: res.ok,
        status: res.status,
        ...(res.ok ? {} : { error: res.error }),
      },
    };
  };
}

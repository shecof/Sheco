// Run both isolated desktop suites sequentially to avoid shared focus interference.
await import('./templates-review.mjs')
await import('./data-recipes-review.mjs')

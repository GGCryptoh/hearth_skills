# Hearth Skills (Public)

Free-tier skill manifests for [Hearth](https://github.com/GGCryptoh/hearth_aios). Anyone can read this; agents in any Hearth install can discover and install these without a subscription.

## Format

Each `.json` file in `free/` is a single skill in the `hearth.skill/1` schema. The full schema reference + Pro/Business catalog lives in the private [hearth_marketplace](https://github.com/GGCryptoh/hearth_marketplace) repo.

## Tiers

| Tier | What's here |
|---|---|
| **Free** | This repo — bundled with every Hearth install at no cost |
| **Member / Pro / Business** | Private marketplace registry, gated by Lemon Squeezy subscription |

See [Hearth pricing](https://hearth.cutlineadvisory.com/pricing) for tier benefits + consulting hours.

## Adding a free skill

1. Fork this repo
2. Add `free/<skill-id>.json` matching the `hearth.skill/1` schema
3. Open PR — automated check validates the manifest
4. On merge, the Hearth marketplace re-seeds within 1 hour

## License

Skill manifests are MIT. Skill handler implementations link to upstream sources (typically MIT or Apache 2).

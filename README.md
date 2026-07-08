# Pokelike Team Analyzer

Userscript (Tampermonkey) for [Pokelike](https://pokelike.xyz).
Adds a floating panel that analyzes your team in real time: offensive coverage, weaknesses, boss preview, and help deciding on the capture and full-team screens.

## What it does

- **Team** - each Pokemon with its type and attack. Hover over it to see weaknesses, resistances, and immunities.
- **Shared weakness** - only the types that hit *the whole team* for x2.
- **SE coverage** - grouped by attack: which types you cover super effectively and with what.
- **Bosses** - the current boss, its Pokemon, and what hits it SE; toggle to preview bosses from upcoming maps.
- **Capture screen** - for each candidate: new coverage it adds, whether it fills a team weakness gap, and what it resists.
- **Full team (swap)** - for each member, what the team gains or loses if you swap them for the one coming in.

## Mechanics notes

- Uses the game's **live type chart** (Gen 5 + Fairy). The Fairy type works for damage (verified in battle).
- An x0 or x1/% (double resistance) attack results in **Struggle (50 power)**, not zero damage - the panel reflects this.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new script and paste the contents of [`pokelike-team-analyzer.user.js`](pokelike-team-analyzer.user.js).
3. Go to pokelike.xyz - the panel appears in the top right corner (draggable and collapsible).

Works well alongside the other Pokelike userscripts (Weakness Panel, Fairy Fix, Evolution Level, Move Tier Hover).

## Credits

Created by Bruno Collazo. Inspired by VasariRulez's Pokelike userscript ecosystem.

## License

MIT

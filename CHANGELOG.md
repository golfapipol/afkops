# Changelog

Notable changes to [afkops](https://www.npmjs.com/package/afkops).

## 0.2.0

### Added

- **Aquarium skin** (`4`). Tanks as nodes, fish as pods. Tank width is capacity,
  stocked blue water is what pods reserved, bubble columns are live usage, and a
  failed node goes cloudy and still. Tier names are `ALGAE` / `GUPPY` / `KOI` /
  `SHARK`; a cordoned node reads `QUARANTINE`.
- Fish **swim through the water column** rather than standing on the floor, and
  **face their direction of travel**. Side-on is the natural view for this skin,
  since that is how you look at a tank.
- Views now understand that some skins' units swim rather than stand, declared by
  the skin as `side.swims`.

### Fixed

- Number keys map onto however many skins exist, instead of being hardcoded to
  three; auto-rotate no longer skips every skin past the third.
- Switching to or from a skin whose units are placed differently re-places the
  sprites immediately rather than waiting for the next state frame.
- The side-on renderer takes gravel colour from a skin's own `grit` where it has
  one, so a skin can use `soil` for something other than earth.

## 0.1.0

First release.

- Node capacity, pod allocation and live usage kept as three separate facts:
  capacity is the plot's width at a fixed units-per-core, allocation is the
  fenced portion, usage is what is lit inside the fence.
- State from `kubectl get --watch --output-watch-events`, not polling, so
  restarts and deletes animate about a second after they happen.
- Severity by restart **rate** rather than count, with an owner-grouped problem
  list and `N` to jump to each.
- Click any pod for its containers, exit reasons and recent events.
- Three skins (farm, factory, dungeon) × two views × two fidelity tiers.
- True scale plus a camera: `WASD`, zoom, `F` to fit.
- 24h history, real-clock day/night cycle, and survives credential expiry.
- Zero npm dependencies; `kubectl` is the transport.

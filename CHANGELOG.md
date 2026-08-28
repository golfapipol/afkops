# Changelog

Notable changes to [afkops](https://www.npmjs.com/package/afkops).

## Unreleased

### Added

- Nodes **arrive and leave visibly**. A removed node used to vanish between two
  frames while every other plot snapped sideways as the packing closed the gap,
  which reads as a glitch rather than as a node leaving the cluster. Its plot now
  holds its place for two seconds, darkens, sinks and is labelled `REMOVED`
  before the layout closes up. New nodes rise into place and are labelled `NEW`.
  A node that comes back mid-departure (a flapping kubelet) cancels its own exit.

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
- **Click a node** — its header band, or any empty part of it — for capacity,
  allocatable, requests, limits and live usage, its conditions and taints, and
  the problems on that node. `GET /api/node?name=…` backs it.
- The **badge on a plot** is now explained in both legends. It marks a node with
  at least one pod needing attention, tinted by the worst severity there and
  blinking for the worst tiers; it had no explanation anywhere before.

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

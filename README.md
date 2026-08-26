# afkops

**Your Kubernetes cluster as an idle game.** A pixel-art wallboard for node
capacity, pod allocation and live usage — every pod is a creature going about its
business, and you can leave it on a screen for a day.

```bash
npx afkops            # a synthetic cluster — no credentials, nothing to install
npx afkops --real     # watch kubectl's current-context
npx afkops --wall     # 24/7 board: keeps the display awake
```

It opens <http://localhost:8787> itself. Press **F11** for fullscreen, **`?`** for
the legend. Read-only — it never changes anything in your cluster.

![Farm skin, top-down](https://raw.githubusercontent.com/golfapipol/k8s-farm-simulation/main/docs/farm-topdown.png)

*Twelve nodes at true scale: `kube-system-pool` has 16 cores so its plot is
genuinely eight times the width of the 2-core pools above it. Green rows are CPU
actually in use, bare soil is reserved-but-idle, and the fence is where the
requests run out. One node is down (red, raining), four pods have nowhere to go,
and the sidebar ranks what needs attention.*

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/golfapipol/k8s-farm-simulation/main/docs/truescale.png" alt="Zoomed in"><br>
<sub><b>Zoomed to 100%</b> — one sprite per pod. Sheep, cows and chickens are
CPU request tiers; a cordoned node reads <code>CLOSED</code>. The minimap shows
how much cluster is off-screen.</sub></td>
<td width="50%"><img src="https://raw.githubusercontent.com/golfapipol/k8s-farm-simulation/main/docs/farm-sideon.png" alt="Side-on view"><br>
<sub><b>Side-on view</b> (<code>V</code>) — the same data as a building. Floor
width is still capacity, so the floors are comparable down the stack.</sub></td>
</tr>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/golfapipol/k8s-farm-simulation/main/docs/factory-night.png" alt="Factory skin at night"><br>
<sub><b>Factory skin at night</b> — same cluster, industrial vocabulary
(<code>POWER</code>, <code>STORAGE</code>, machines on floors). The palette
follows the real clock.</sub></td>
<td width="50%"><img src="https://raw.githubusercontent.com/golfapipol/k8s-farm-simulation/main/docs/dungeon-topdown.png" alt="Dungeon skin"><br>
<sub><b>Dungeon skin</b> — rooms and a party, torch-lit. Pod tiers become
<code>IMP</code>/<code>ROGUE</code>/<code>KNIGHT</code>/<code>GIANT</code>.</sub></td>
</tr>
</table>

![8-bit tier](https://raw.githubusercontent.com/golfapipol/k8s-farm-simulation/main/docs/farm-8bit.png)

*The same board in the **8-bit** tier (`G`): a fixed 640×360 buffer, integer-upscaled
and letterboxed, with flat colour and dithered shading instead of gradients.*

All screenshots are of the **synthetic demo cluster** — see
[Screenshots](#screenshots) for why, and how to regenerate them.

| key | action |
|---|---|
| `1` `2` `3` | Farm / Factory / Dungeon skin |
| `V` | view: top-down ⇄ side-on |
| `G` | graphics: 8-bit ⇄ 64-bit |
| `Q` / `W` | force 8-bit / 64-bit |
| `WASD` / arrows | move around the scene |
| `+` `-` / scroll | zoom |
| `F` | fit the whole cluster on screen |
| `N` / `Shift+N` | jump to the next / previous problem |
| `L` | full legend overlay |
| click a pod | inspect it |
| `Esc` | close a panel |
| `Tab` or click | cycle skin |
| `R` | reload |

All three choices persist in `localStorage`, so the board comes back the way you
left it after a reload or the nightly refresh.

## Views and graphics tiers

Skin, view and fidelity are independent — any of the twelve combinations works,
because all three describe the same data rather than replacing it.

**Views**

- **Top-down** — nodes are plots of land on a grid, seen from above.
- **Side-on** — nodes are floors of a building, stacked, with pods standing and
  working along each floor. The classic idle-game arrangement. Floor *width* is
  capacity, so node sizes are directly comparable down the stack.

**Graphics**

- **8-bit** — a fixed 640×360 backbuffer, integer-upscaled. Deliberately chunky:
  flat colour, dithered shading, 5×5 sprites.
- **64-bit** — the backbuffer is sized to your display instead of to a retro
  grid, so detail is limited only by the screen. Real gradients, parallax
  layers, contact shadows, glow and lighting, and larger multi-shade sprites
  with outlines and alternating gait.

Both tiers draw from one set of code in a shared 640×360 design space; the
renderer applies a scale transform and the skins add detail that only exists
when the tier can resolve it. That is why adding the second tier did not fork
the art into two codebases.

## The one thing worth understanding

Most cluster dashboards show a single "node is 80% full" number, which quietly
merges three different facts. This one keeps them apart and draws all three:

| Layer | What it means | Where it comes from |
|---|---|---|
| **Capacity** | The hardware, minus kube-reserved / system-reserved / eviction threshold. The scheduler only ever looks at `allocatable`. | `.status.allocatable` |
| **Allocation** | Requests promised to pods, used or not. This is what makes a node unschedulable. | summed from pod specs |
| **Usage** | CPU seconds and bytes actually being consumed right now. | metrics-server (`kubectl top`) |

On screen: **capacity is the size of the plot**, **allocation is the fenced-off
area**, and **usage is the part actually growing inside the fence**. So:

- Fenced wall to wall but bare soil inside → **overcommitted requests**. You are
  paying for reservations nothing uses.
- Things working *outside* the fence → **BestEffort pods with no requests set**,
  burning real CPU the scheduler cannot see.
- Growth pushing past the fence → heading into throttling / eviction territory.
- The pip row on each plot is **pod count against the node's pod ceiling**
  (commonly 110 on GKE) — the limit that bites while CPU still looks idle.

## What each creature means

Click the **`?`** button (bottom right) or press **`L`** for the full legend; a
compact version is always in the sidebar, drawn with the real sprites so it
cannot drift from the scene. The dialog names the symbols for whichever skin is
active, and closes itself after 90s so an unattended board goes back to showing
the cluster.

The button bar next to it — **skin / view / graphics** — is the clickable version
of the keyboard shortcuts, since a wallboard has nobody to tell you the keys.

Every creature is **one pod**. Its **shape is what it reserved**; how it
**moves and how brightly it is lit is what it actually uses**. Those are
different facts, so they get different visual channels and can disagree — which
is the whole point.

| Farm | Factory | Dungeon | CPU request |
|---|---|---|---|
| Crop | Belt | Imp | **none** — BestEffort, the scheduler sees nothing |
| Chicken | Press | Rogue | up to 100m |
| Sheep | Furnace | Knight | up to 500m |
| Cow | Reactor | Giant | over 500m |

Thresholds are fixed round numbers, not percentiles of the current cluster, so a
chicken means the same thing tomorrow and on someone else's cluster. Sprites also
scale a little with their tier, so size reads as size.

| What you see | What it means |
|---|---|
| Dull and barely moving | using very little of what it reserved |
| Fully lit and bustling | working at about its request |
| **Orange caret above the head** | happening **now** — using more CPU than it reserved |
| **Pale scars under the feet** | already happened — it has restarted before |
| Standing outside the fence | no request at all |
| Basket / crate / loot | a Job or CronJob pod |
| Faded into the background | a dimmed namespace, e.g. `kube-system` |

Those two markers were originally both small red marks above the sprite, which
at four pixels is the same mark twice. They are different kinds of fact — one is
a live condition, the other is history — so they now differ on three independent
channels at once: **position** (above vs. below), **colour** (hot orange vs. pale
bone) and **motion** (the caret bobs, the scars are static). Any one of the three
is enough to tell them apart at the smallest sprite size.

The scar bar grows with the restart count rather than trying to draw one pip per
restart; past ten it doubles up, because "751 restarts" and "12 restarts" are the
same message.

The banner across the top of the scene — *"2 CRITTERS WAITING FOR A PLOT"* —
counts pods that exist but have not been given a node yet: either still being
scheduled, or nothing in the cluster has room for them. It only appears when
there are any.

A pod with no request has no reservation to be a fraction of, so it is measured
against a nominal 100m — enough to animate honestly without implying a
reservation that does not exist. Missing metrics render as *unknown*, never as
idle.

## Finding the problem

Nine hundred sprites is too many to scan for a four-pixel mark, so the board
ranks trouble and points at it.

**Restart count is not a problem.** A pod that restarted twice in thirty days is
fine; one restarting every hour is not. Severity therefore uses the restart
*rate*, which on the reference cluster turns "203 pods with restarts" into **3
that are actually churning** — the other 200 are old scars on stable pods.

| Level | Meaning |
|---|---|
| `CRASH` | restarting in a loop right now |
| `FAILED` `NO NODE` `CHURN` | failed, unschedulable, or restarting repeatedly |
| `STARVED` `NOREADY` | over its CPU request *and* restarting, or failing its probe |
| `OVER` | using more CPU than it reserved |

Finished Jobs are not problems, and pods below `OVER` are not listed at all.

Three things then make it findable:

- **A ranked PROBLEMS panel**, worst first, **grouped by owner** — seven failing
  pods of one CronJob is one line reading `FAILED … ×7`, not seven lines burying
  everything else. Click a row to jump to it.
- **A severity badge on each node**, drawn at a constant on-screen size so it
  stays visible at any zoom. Sprite markers disappear when you zoom out; the
  badge is how you see which plot is in trouble from across the room.
- **`N` steps through problems** worst-first: the camera centres on the pod and
  opens its detail. Spotting and diagnosing is one keypress. Stepping walks
  *groups*, so it does not march you through six replicas of the same fault.

## Clicking a pod

Click any creature to inspect the pod it stands for. Because sprites can be four
pixels across on a busy node, picking is by nearest-centre with a forgiving
radius rather than a strict hit test — you do not need surgical aim. The selected
pod gets a flashing marker so you can find it again in a crowd of ninety.

The panel is assembled from the pod object the server already holds, so a click
costs no extra cluster call:

- **identity** — namespace, node, owner (Deployment/DaemonSet/Job), pod IP, age
- **status** — phase, readiness, QoS class, and any pod-level reason
- **reserved vs used** — request, limit and live usage on one bar per resource,
  so a pod reserving 350m and using 7m is obvious
- **containers** — image, state, restart count, and *why it last died*
  (`lastExit: Error (2)`), which is where a restart loop explains itself
- **recent events** — including the noisy ones the animation layer filters out;
  `BackOff: Back-off restarting failed container` is usually the real answer

Panel height follows the content, and if the pod is deleted while you are reading
it the panel says so rather than showing stale numbers.

The pointer is hidden while the mouse is still, and reappears the moment it moves
— a wallboard should not display a stray cursor all day, but it still has to be
usable.

## What you watch happen

State comes from `kubectl get --watch --output-watch-events`, not polling, so
things animate about a second after they really happen — and a Job pod that
starts and finishes inside a poll interval can't slip past unseen.

Restarts knock a sprite down and add a skull pip. Job completions are a harvest,
not a death. Deletions dissolve and the fence visibly shrinks. Rescheduled pods
walk to their new plot. Deployment and HPA scaling raise a banner then spawn in
sequence; a big scale-up collapses into one `×47` line rather than backing up the
animation queue. Node add/remove, cordon, and NotReady all have their own state.

The bottom strip is the **last 24 hours** as scenery rather than a chart: one
pixel column per 30 seconds, height is allocation, the bright line is real usage,
red ticks are incidents.

The palette follows your actual wall clock through dawn, day, dusk and night.

## Requirements

| | Needs | Why |
|---|---|---|
| **kubectl** | **1.20 or newer**, on `PATH` | The board reads state from `kubectl get --watch --output-watch-events`, which arrived in 1.20. Checked at startup: an older kubectl is reported and refused rather than producing a board that silently never fills. |
| **Node.js** | **18 or newer** | Server uses only `node:` built-ins — no npm dependencies. `node --test` needs 18. |
| **Cluster** | any Kubernetes reachable by your kubectl | Verified against GKE 1.35. Read-only throughout. |
| **metrics-server** | optional | Supplies the *usage* layer. Without it capacity and allocation still render and the usage channel simply goes dark. Preinstalled on GKE, EKS and AKS. |
| **Browser** | Chromium / Firefox / Safari from ~2020 | Canvas 2D with `CanvasPattern.setTransform`. |
| **Auth plugin** | `gke-gcloud-auth-plugin` (GKE) or `aws-iam-authenticator` (EKS) | Whatever your kubectl already needs. kubectl does the authenticating, which is the reason it is the transport. |

`npx afkops --wall` asks the OS not to sleep the display — `caffeinate` on macOS,
`systemd-inhibit` on Linux. Both are optional: if neither is present the board
still runs, it just won't stop a screensaver.

### Cluster permissions

Read-only. The board never mutates anything:

```yaml
rules:
  - apiGroups: [""]
    resources: [nodes, pods, events]
    verbs: [get, list, watch]
  - apiGroups: ["metrics.k8s.io"]        # optional: the usage layer
    resources: [nodes, pods]
    verbs: [get, list]
```

### Nothing to install

Zero npm dependencies, so `npx afkops` fetches ~90 kB and nothing else. Clone the
repo instead if you want to hack on it — there is still nothing to install.

## Configuration

`config.json`:

```json
{
  "namespaces": {
    "include": [],
    "exclude": [],
    "dim": ["kube-system", "kube-public", "kube-node-lease"]
  },
  "defaultSkin": "farm",
  "autoRotateSkinMs": 0,
  "nightlyReloadHour": 4
}
```

`include` empty means all namespaces. `dim` renders a namespace as background
wildlife instead of hiding it. Note that **`exclude` only hides pods from the
scene — their requests still count against the node**, because the node really
is that full.

## Running unattended

Built to be left alone. Credential expiry, API outages and dropped watches are
normal states, not crashes: the last known world stays on screen behind a
`CLUSTER UNREACHABLE` banner with an actionable message (`GKE credentials
expired - run: gcloud auth login`), watches respawn with backoff, and it
recovers on its own when access comes back.

Memory is bounded by construction — fixed-size ring buffer for history, capped
event log, sprite pool, and a transition map reconciled against live pods on
every snapshot. Measured flat at ~50-55 MB RSS under 13× normal cluster churn.

`GET /api/health` reports RSS, client count and collector state if you want to
watch it from outside. `GET /api/pod?uid=…` returns the full detail for one pod,
which is what the inspect panel reads.

A bounded ring of the last 800 cluster events is kept in memory purely so a pod's
own events can be shown on click; the transitions layer only keeps the few
reasons worth animating.

## Development

### Screenshots

```bash
git clone https://github.com/golfapipol/k8s-farm-simulation && cd k8s-farm-simulation
npm test             # 53 tests, no install step
npm run shots        # regenerates docs/*.png from the demo cluster
```

Always captured from `--demo`, never from a real cluster. The board is a picture
of whatever it is pointed at, so a screenshot of a live cluster publishes its
node pools, namespaces and workload names — using the synthetic cluster keeps
that out of the repo by construction.

The capture drives headless Chrome over the DevTools Protocol rather than using
Chrome's `--screenshot` flag: the board animates continuously, so it never
reports "idle" and the flag hangs. CDP also lets the capture wait for sprites to
finish walking to their places, and it refuses to save a shot if the page logged
any draw errors.

### Deep links

Board state can be set by query parameter, which is how the screenshots are
scripted and how you would point two kiosks at different views:

```
?skin=farm|factory|dungeon &view=topdown|sideon &tier=8bit|64bit
&zoom=fit|<number>         &hour=0-23        # pins the day/night palette
```

A parameter beats a stored preference, and both beat `defaultSkin` in
`config.json`.

```bash
npx afkops --seed-history               # pre-fill the 24h ribbon
npx afkops --nodes=12 --pods=250        # size the synthetic cluster
npx afkops --clock-speed=400            # sweep a whole day in ~4 minutes
npx afkops --beat=200                   # heavy churn, for soak testing
```

Zero npm dependencies; `kubectl` is the transport, which is what makes the GKE
and EKS exec-credential plugins work without reimplementing them.

### True scale, and a camera

A node's **width is its allocatable CPU** at a fixed number of pixels per core,
identical on every node. That is what makes the fence mean something: the fence
is a fraction of the plot's width, so the fence's *width is the reserved cores*
and is directly comparable between a 1-core node and an 8-core one.

The earlier fit-to-cell grid could not do this. On the reference cluster the
largest node has 8× the capacity of the smallest, and that layout rendered the
difference as about 1.3× — every node looked roughly the same size, so a fence at
"half full" looked identical whether it meant 1 core or 4.

The consequence is that a real cluster no longer fits on screen, so the scene has
a camera: **WASD** or the arrow keys to move (held keys accelerate and glide),
**`+`/`-`** or the scroll wheel to zoom, **`F`** to fit everything at once. A
minimap in the corner shows the whole world with your viewport inside it, and
only appears when there is more to see. Zoom is remembered like the other
preferences; the default is true scale.

### Every pod gets a sprite

There are no `+47` badges. A per-node cap looks tidy but hides most of a busy
node, which is the opposite of what the board is for.

Density is absorbed by **sprite size** instead: each view measures the space a
plot affords and divides it by how many pods are actually there, so one plot can
hold 5 pods at full detail or 90 as a crowd. Below ~7 design units the detailed
art is smaller than its own outline, so sprites drop to a compact form that still
carries all three facts — size for the request tier, brightness for real usage,
colour for phase. On the reference cluster sprite sizes land between 4.4 and 9
units depending on the node.

Pods also **wander** inside their own band rather than sitting on a grid: busier
pods (higher usage) roam more, which is the same fact the brightness shows. Wander
targets are clamped to the band, so nobody strolls off the plot or across the
fence that marks what they reserved.

Measured on the reference cluster (20 nodes, ~870 pods, all sprites drawn):

| | top-down | side-on |
|---|---|---|
| 8-bit | 2.6 ms (380 fps) | 4.9 ms (203 fps) |
| 64-bit | 8.1 ms (124 fps) | 8.5 ms (117 fps) |

The one real cost was `dither()`: a full-screen 8-bit dither is ~77,000
`fillRect` calls, which on its own cost more than every sprite combined and made
8-bit *slower* than 64-bit. Large areas now use a cached repeating tile, which
took the worst frame from 16.4 ms to 6.2 ms.

### Scale

Verified on a 20-node / ~880-pod GKE cluster. Node labels are reduced to the
part that actually distinguishes them — `gke-prod-cluster--web-pool-1a2b3c4d-x7q9`
displays as `web-pool/x7q9` — by stripping the prefix every node shares
and the instance hash.

In side-on view the building grows sideways into more towers rather than letting
floors shrink below standing room. Beyond roughly 40 nodes individual plots get
too small to read usefully. Hard sprite limits (400 per node, 3000 total) remain
only as a runaway guard far above any cluster this board is meant for; if one is
ever hit the overflow is still counted on screen rather than silently dropped.

Sprite grids are derived from plot geometry, never from the live pod count. That
matters more than it sounds: on a busy cluster pods come and go constantly, and
a count-derived grid re-targets every sprite on every update, so nothing ever
settles and the scene just churns.

## Credits

Zero npm dependencies. The one bundled asset is the pixel typeface
**[Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)** by
CodeMan38, vendored at `public/assets/PressStart2P.woff2` under the
[SIL Open Font License 1.1](https://openfontlicense.org/) so the board renders
correctly with no network access.

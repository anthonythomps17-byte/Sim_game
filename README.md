# My Life

A cosy, Sims-style life simulator set in a stylised Ashton-in-Makerfield. It runs in the browser, is built for a tablet or phone with touch controls, and works offline once installed to the home screen. No accounts, no ads, no chat, no in-app purchases.

The name lives in `src/ui/title.ts` (and `index.html` / `public/manifest.webmanifest`). Live at https://ashton-life.netlify.app.

## Play it

```bash
npm install
npm run dev        # http://localhost:5173 (also on your Wi-Fi, so you can open it on the tablet)
```

Production build and preview:

```bash
npm run build      # typecheck + build into dist/
npm run preview    # serve dist/ (the service worker and offline mode only run in this build)
npm test           # simulation tests (no browser needed)
```

To put it on the tablet: deploy `dist/` (for example to Netlify; `netlify.toml` is included), open it in Safari or Chrome, then **Share → Add to Home Screen**. After the first load it works with no internet.

## Controls

| Action | Touch | Mouse / keyboard |
| --- | --- | --- |
| Pan | Drag with one finger | Left-drag, WASD / arrows |
| Zoom | Pinch | Wheel, + / - |
| Rotate | Two-finger twist, or ⟲ ⟳ | Right-drag, Q / E |
| Tilt | ⤢ button | Right-drag up/down |
| Select a Sim | Tap the portrait or the Sim | Click |
| Do something | Tap an object, pick from the menu | Click |
| Details | Long-press an object or Sim | Hold click |
| Walk somewhere | Tap the ground → Go here | Click |
| Cancel an action | Tap it in the queue at the bottom | Click |

Walls button cycles **cutaway → up → down**. Buy and Build modes pause time, like The Sims.

## What's in it

All eight roadmap milestones from the spec have a playable version:

1. **Walking Sim**: 3D lot with sun, shadows and day/night lighting; Sims walk where you tap; touch orbit camera.
2. **Needs**: all 8 needs, 50+ objects, tap-to-queue actions, game clock with pause/1x/2x/3x, weekdays and weekends.
3. **Free will**: utility AI (objects advertise, Sims score need gain × urgency × traits ÷ distance, pick from the top 3), mood, moodlets, free will off/low/full, variety so Sims don't repeat themselves.
4. **Create-a-Sim**: body, height, skin, 11 hair styles, hair/eye colour, 4 faces, freckles, 5 tops, 3 bottoms, colours; 16 traits; 9 aspirations; households of up to 4.
5. **Work and money**: 6 careers plus a part-time café job, each with levels, hours, skill requirements and promotions; weekly bills that scale with home value; buy catalogue grouped by room.
6. **Build mode**: walls, whole rooms, doors, windows, 10 floors, 10 wall paints, cutaway view, move/rotate/sell furniture.
7. **People**: friendship and romance (romance can be switched off), 13 social actions, 8 neighbours from the six districts who visit or can be invited.
8. **Polish**: 3 save slots plus autosave each in-game day, export/import save files, synthesised sound effects and music, offline install, a short tutorial.

Ashton flavour: red-brick terraces and slate roofs, a church spire and pit-head winding gear on the skyline, an Engineer career at the lock and hinge works, a Locksmith's Workbench, and off-lot outings to the High Street, the market (Tuesdays and Saturdays, with rare finds), the Gerard Centre, the football ground, the racecourse on Saturdays, St Thomas' green and a heritage museum. Your home, street and school stay fictional.

## Everyday life

- **Time:** at normal speed the day (7am–9pm) takes 15 real minutes and the night 8.5. Speeds 2x and 3x are faster. While everyone is out (work, holidays) the game skips ahead; skipping while everyone sleeps is an option in Settings.
- **Jobs:** Chef, Musician, Athlete, Scientist, Artist, Engineer, Coffee Shop, Baker (very early starts), Lifeguard, Teacher (school holidays off), Shop Worker, Bar Worker (evenings) and Card & Balloon Shop. Some top jobs need a driving licence.
- **Food:** cooking uses food from the fridge (🛒 next to the money). Restock with a big shop at Aldi or a corner-shop top-up. If the fridge is empty, hungry Sims order a takeaway.
- **Clothes:** go clothes shopping, try things on, then pay for what you keep.
- **Driving:** five driving lessons, then the test. With a licence and a car (Buy → Garden), Sims drive to work and get home from outings sooner.
- **Calendar:** a year is four week-long seasons. Easter Sunday (egg hunt), summer holidays (book Blackpool or Spain if you have saved up), Halloween (pumpkin, trick or treating), Bonfire Night (fireworks), Christmas Eve (tree), Christmas Day (presents, no work) and New Year's Eve (midnight fireworks). Snow in winter, blossom in spring, gold leaves in autumn. Tap the clock for the calendar.
- **Running the home** (🏠 button, top right):
  - Bills are split into rent and council tax, energy, and TV subscriptions (Netflix £8/week, Sky Sports £22/week, which add shows and live matches to the TV).
  - Solar panels cut energy by 25% each (up to 2) and a heat pump by 35%. Neither raises your rent.
  - Chores: dust builds up (hoover the house), weeds grow (weed the garden, faster in summer), and bin day is Thursday (take the wheelie bin out on Wednesday night or it overflows).
  - Things break: drains get blocked (unblock them yourself or pay a plumber £120) and the boiler can fail, more often in winter (cold showers and no heating until it's fixed, by you with Logic or by an engineer for £250). Servicing the boiler makes a breakdown less likely.
- **Laundry:** dirty clothes and bedding pile up. Do the washing, then hang it on the rotary line (dries fast in summer, slowly in winter) or tumble dry it (adds to the electricity bill). Leave a wash in the machine overnight and it goes smelly. Beds get grubby: change the bedding for fresh sheets.
- **Petrol:** driving uses fuel. Fill up at the petrol station (tap the car, or Go out). With an empty tank, Sims take the bus.
- **Pets:** adopt a dog, cat, parrot, rabbit or hamster from the Ashton Animal Rescue (menu → Pets, or tap your Sim → Adopt a pet). Choose a name and colour; the cage, hutch or food bowl is set up for you.
  - Dogs and cats roam the house and garden, eat from the bowl, nap and (dogs) follow you about. Tap them to fuss, play fetch or with a feather toy, brush, bath, teach tricks, or walk the dog.
  - The parrot learns words when you talk to it and says them in a speech bubble. The rabbit hops round its hutch, and the hamster runs on its wheel at night.
  - Pets get hungry, bored and grubby, and say so with a bubble. Neglect makes your Sims worried, but pets never come to harm. Pet food comes from the pet shop (and a bit with the big food shop). Pet care adds a little to the weekly bills, and there's an Animal Lover trait.
- **More to do:** summer barbecues (too cold in winter), walks in the park or round the block, bargain hunting at B&M (25% off voucher), and washing the car after driving.
- **Parties:** tap your Sim → Plan a party. Pick karaoke, dance or barbecue, a time and up to 6 friends. Noise after 10pm upsets the neighbours: first a bang on the wall, then a complaint, then an £80 fine.

## The neighbourhood

The streets around the lot follow the layout of a real corner of Ashton: a side street of red-brick terraces, a crossing road just north, an avenue and a park to the west, a curving main road to the east, a wider road to the south and a primary school beyond it, plus a few corner shops. The street and school names are made up on purpose, and no house is marked as anyone's real home, because the game is on a public website. The plan is a list of points in `streets()` in `src/view/scenery.ts`.

## How it's built

| Layer | Choice |
| --- | --- |
| Engine | Babylon.js 9 (WebGL 2), tree-shaken imports |
| Language | TypeScript, strict |
| Build | Vite |
| UI | Plain HTML/CSS over the canvas, no framework |
| Saves | IndexedDB (3 slots + autosave), JSON export/import |
| Offline | Generated service worker + web app manifest |
| Tests | Vitest, against the simulation core only |

```
src/
  sim/        Simulation core. Plain TypeScript, no Babylon.js, no DOM.
    data/     All content as JSON: objects, traits, careers, aspirations, socials, moodlets, build materials
    game.ts   Game state wrapper and the per-minute tick
    actions.ts  Action state machine: route → walk → perform → finish
    ai.ts     Utility-scoring free will
    schedule.ts Work, bills, visitors, lamps, aspirations
    build.ts  Build/buy commands (all money checks happen here)
    lot.ts, path.ts  Grid, walls, rooms, A* pathfinding
  view/       Babylon.js: reads the game state and draws it
    world.ts  Engine, lights, sky, picking
    lotView.ts  Walls (cutaway), floors, furniture, previews
    models.ts Procedural low-poly furniture
    simAvatar.ts  Procedural, animated Sims
  ui/         HUD, menus, create-a-Sim, buy/build modes
  platform/   Storage and audio
tests/        Simulation tests
```

The simulation never talks to the 3D view. Taps become commands (`enqueue`, `buyObject`, `placeWalls`…) that change the plain-JSON game state, and the view redraws from it. The same core runs in the tests at thousands of game minutes per second.

**Adding content** usually means editing JSON in `src/sim/data/`. A new object also needs a model builder in `src/view/models.ts` (a few primitives) and an icon in `src/ui/buy.ts`.

### Models and animation

The spec suggests Kenney/Quaternius glTF packs and Mixamo animations. This version builds every model and animation in code instead, so it needs no downloads and has no licences to track. Each object is merged into a single vertex-coloured mesh (one draw call), and walls and floors use thin instances, so the whole house costs only a handful of draw calls on a tablet. Swapping in glTF models later only touches `src/view/models.ts` and `src/view/simAvatar.ts`.

## Not in this version

- Multiplayer. Two people can share a household on one device by taking turns with the portraits. Playing on two devices at once would need a server and accounts, which goes against the spec's offline, no-chat design.
- Visiting community lots in 3D (the places exist as off-lot outings for now).
- Ageing and generations, multiple lots, online play (out of scope for v1 in the spec).
- Hand-made art: everything is procedural for now.

## Open questions from the spec

These are still hers to decide; the defaults chosen here are easy to change:

- **Name**: "Ashton Life" placeholder (`src/ui/title.ts`).
- **Careers**: Chef, Musician, Athlete, Scientist, Artist, Engineer, plus a part-time café job (`src/sim/data/careers.json`).
- **Style**: smooth low-poly cartoon.
- **Romance**: on by default, switchable to friendships only in Settings; housemates are treated as family, so romance is only with neighbours.
- **Ageing**: Sims stay the same age.
- **Designing her own things**: furniture, clothes and traits are all JSON, so she can add or tweak them.

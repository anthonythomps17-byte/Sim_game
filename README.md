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

## Out and about

Sims can walk out of the front door into the neighbourhood. The street outside, Town Green Park, the Town Green Café, Aldi and Hillcrest Primary School are real places to walk around, not just a timer.

- **Getting there:** tap your Sim → 🌳 Go to the park or ☕ Go to the café, tap anything in the park or café, or tap the pavement → Go here. They walk down Larkfield Close and Wellbrook Road to get there. Tap your Sim → 🏠 Go home to come back.
- **Walk mode (🕹️):** steer your Sim yourself with the joystick (or WASD / arrow keys on a computer) while the camera follows. Walk straight out of the garden into the street. Tapping still works for using things and chatting.
- **The park:** swings, a slide, picnic tables, benches, an outdoor chess table, the duck pond (feed the ducks), a football goal for a kickabout, and the ice cream van (spring to autumn, 10am–6pm).
- **Aldi** (8am–10pm): walk the aisles and pick tins and pasta, fruit and veg, bread, snacks, fridge and freezer food, and pet food into your basket (the Sim panel shows it), then pay at a till. Rummage in the middle aisle for oddities and the odd voucher. Walk out without paying and the shopping goes back.
- **Hillcrest Primary School** (opposite the park): maths, art and cookery lessons at the desks (weekdays 9–3, not in the summer holidays) build skills; evening classes (£10) after school; a reading corner, the hall stage, piano and PE mats; and a playground with a climbing frame, hopscotch and a goal.
- **Busy streets:** people walking by (some with dogs), kids on bikes, cars that stop when your Sims cross, the postman on weekday mornings, the bin lorry on Thursday morning and the school run at 8:30 and 3:15. They're scenery only, so they cost nothing to save or share between devices.
- **The café** (open 7am–7pm): order a coffee, tea and cake, a hot chocolate or a full English breakfast at the counter, then sit at a table. There's a customer toilet, armchairs and a bookshelf.
- **Neighbours are out too:** they come and go through the day (more at weekends), using the park and café. Chat to them to make friends; then they're in your phone's contacts.
- With free will, your Sims go out for a while now and then when they're bored or lonely, and head home when tired or when it gets late.
- **Relaxed needs** (Settings): needs go down about half as fast, for more time to explore.

## Growing up

- **Ages:** in create-a-Sim, pick Child, Teen or Adult for each Sim (every household needs a grown-up). Children and teens are drawn smaller.
- **School:** on school days (weekdays in term time; not the summer holidays or Christmas Day) children walk to Hillcrest Primary with the school run and sit in class 9am–3pm with their classmates (neighbours' children), then walk home. Teens catch the bus to Ashton High (off-screen) until 3:30. Tap a child → Job tab → 🎒 Go to school if they're late.
- **Homework and reports:** school days bring homework (tap the Sim → Do homework). Missing school or forgetting homework lowers their grade; going to school in a good mood and doing homework raises it. Reports come out on Friday afternoons (A* to D), with reward points for an A.
- **Birthdays:** children and teens have a birthday every two game weeks (a cake appears), growing into teens, then adults who can get jobs, learn to drive and fall in love. Switch it off in Settings → Growing up.
- **Rules for children:** no jobs, no driving, no romance, and no using the cooker (snacks are fine). Children go to bed early.

## Jobs you can see

Café, shop and teaching jobs happen in town. Sims walk to work an hour or so before their shift and work where you can watch them: baristas behind the café counter, shop workers stacking shelves at Aldi, teachers at the whiteboard at Hillcrest (with any children in the class). At the end of the shift they're paid and walk home. Leave early and you only get half pay, and the boss notices. Other jobs still happen off-screen.

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
- **Dirty clothes:** what a Sim wears gets grubbier through the day, much faster when working out, gardening, cleaning, with the pets or at work (bakers come home floury). Grubby clothes show stains; filthy ones go muddy, attract flies, make the Sim pong and feel awful. Sims change into a clean outfit after a shower, or tap a wardrobe or chest of drawers → Change into clean clothes. Each change puts the worn outfit in the laundry basket and uses a clean one from the wardrobes (see 🏠 Home).
- **Laundry:** worn clothes, towels and bedding pile up in the basket. Do the washing, then hang it on the rotary line (dries fast in summer, slowly in winter) or tumble dry it (adds to the electricity bill); dried washing goes back in the wardrobes as clean outfits. Leave a wash in the machine overnight and it goes smelly. Run out of clean clothes and everyone's stuck in dirty ones. Beds get grubby: change the bedding for fresh sheets.
- **Mobile phones:** tap your Sim → 📱 Phone, or the 📱 on their panel (a badge shows new messages).
  - **Messages:** text anyone you've met: say hi, send a meme, ask them round, flirt or say sorry. They reply a little later, and it changes how they feel about you. Friends text too: "Fancy a brew at yours?" and "Coming for a walk?" have Yes/No buttons. The boss asks about extra hours (more pay on the next shift) and the bank texts the bills with a Pay button.
  - **Calls:** ring a friend for a natter from Contacts. Friends ring too: answer or decline (free will picks up if you leave it ringing, otherwise it's a missed call).
  - **Apps:** Shop (Aldi online food shop, pet food and treats, delivered in 3 hours), Bank (balance, allowance, pay bills), Vet, Takeaway, Selfie, Social media and Calendar.
- **Petrol:** driving uses fuel. Fill up at the petrol station (tap the car, or Go out). With an empty tank, Sims take the bus.
- **Pets:** adopt a dog, cat, parrot, rabbit or hamster from the Ashton Animal Rescue (menu → Pets, or tap your Sim → Adopt a pet). Choose a name and colour; the cage, hutch or food bowl is set up for you.
  - Dogs and cats roam the house and garden, eat from the bowl, nap and (dogs) follow you about. Tap them to fuss, play fetch or with a feather toy, brush, bath, teach tricks, or walk the dog.
  - The parrot learns words when you talk to it and says them in a speech bubble. The rabbit hops round its hutch, and the hamster runs on its wheel at night.
  - Pets get hungry, bored and grubby, and say so with a bubble. Neglect makes your Sims worried, but pets never come to harm. Pet food comes from the pet shop (and a bit with the big food shop). Pet care adds a little to the weekly bills, and there's an Animal Lover trait.
  - **Poo:** dogs go in the garden about twice a day (or on their walk). Tap it → Pick up the poo, or someone will tread in it (dirty clothes and a nasty moodlet). Accidents indoors smell and spoil the room. Cats use a litter tray (set up when you adopt): clean it out or they'll go elsewhere. Cages and hutches fill with droppings as the pet gets grubby: clean them out.
  - **Health:** dogs and cats sometimes catch fleas (scratching, itchy Sims): tap them → Flea treatment (£15). Pets occasionally feel poorly and need the vet (£60, from the Pets panel or the phone's Vet app); they get better on their own after a few days otherwise.
  - **Treats and play:** give treats (buy them at the pet shop or online), put the hamster in its ball, let the rabbit hop round the garden or the parrot out for a fly. Muddy dog walks in autumn and winter mean muddy paws through the house.
- **More to do:** summer barbecues (too cold in winter), walks in the park or round the block, bargain hunting at B&M (25% off voucher), and washing the car after driving.
- **Parties:** tap your Sim → Plan a party. Pick karaoke, dance or barbecue, a time and up to 6 friends. Noise after 10pm upsets the neighbours: first a bang on the wall, then a complaint, then an £80 fine.

## Playing as a family

Menu → **Family players** turns on family mode: several people share one household on one device, passing the tablet between them.

- Each player has a name, a colour and (optionally) a 4-digit PIN, and looks after their own Sims. Others can watch them but not give them instructions.
- **Money managers** can spend freely. **Family members** get a weekly allowance (reset every Monday). Anything bigger, and household decisions (bills, subscriptions, pets, holidays, selling furniture), needs a money manager to say yes on the spot, with their PIN if they set one.
- Tap the 👤 player button at the top to switch players.

## Playing on several devices

The family can play the same household at the same time, each on their own phone or tablet.

1. On the device that has the game: Menu → **📡 Play on other devices** → **Start sharing**. It shows a 6-character code.
2. On another device: open My Life, tap **📡 Join a family game**, type the code and a name for the device.
3. The first device asks whether to let it in. Devices let in once join straight away next time (Forget them from the same screen).
4. With Family players set up, each device picks who it is. Players can only instruct their own Sims, and spending over an allowance pops up on the money managers' devices to say yes or no (or they type their PIN in 🔔 Messages on the asking device).

How it works: the sharing device (the host) runs the world and keeps the save, so keep the game open there; if it goes to sleep, everything pauses until it wakes. Other devices get the world once, then small updates every second (about 1 KB), and run it forward themselves in between so Sims move smoothly. Everything they do is sent to the host as a command (`src/sim/commands.ts`), which checks it and runs it.

The devices talk through a tiny relay at `/relay` (`netlify/server/index.mjs` and `server/relay.mjs`) on Netlify Server. The relay only passes messages between devices in the same game. It has no accounts, stores nothing, and forgets a game as soon as its devices leave. Codes are random, the host lets each device in, and an address that tries too many wrong codes is made to wait. There is still no chat.

To try it locally: `npm run relay` in one terminal and `npm run dev` in another (Vite forwards `/relay`).

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
| Playing together | WebSocket relay on Netlify Server (`ws`), JSON diffs of the game state |
| Tests | Vitest: simulation core, sync, commands, relay |

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
    commands.ts  Everything a player can do, as data (run here, or sent to the host device)
    town.ts   The park, café and streets: a second walkable map joined at the front gate
    steer.ts  Walking a Sim directly (joystick)
  view/       Babylon.js: reads the game state and draws it
    world.ts  Engine, lights, sky, picking
    lotView.ts  Walls (cutaway), floors, furniture, previews
    models.ts Procedural low-poly furniture
    simAvatar.ts  Procedural, animated Sims
  net/        Playing on several devices: relay connection, world updates (sync.ts), host and guest sessions
  ui/         HUD, menus, create-a-Sim, buy/build modes, sharing and joining
  platform/   Storage and audio
server/       The family relay (plain Node, also run by tests/relay.test.ts)
netlify/server/  Netlify Server entry for the relay
tests/        Simulation, sync, command and relay tests
```

The simulation never talks to the 3D view. Taps become commands (`{ t: 'queue' }`, `{ t: 'buy' }`, `{ t: 'walls' }`… in `commands.ts`) that change the plain-JSON game state, and the view redraws from it. The same core runs in the tests at thousands of game minutes per second.

**Adding content** usually means editing JSON in `src/sim/data/`. A new object also needs a model builder in `src/view/models.ts` (a few primitives) and an icon in `src/ui/buy.ts`.

### Models and animation

The spec suggests Kenney/Quaternius glTF packs and Mixamo animations. This version builds every model and animation in code instead, so it needs no downloads and has no licences to track. Each object is merged into a single vertex-coloured mesh (one draw call), and walls and floors use thin instances, so the whole house costs only a handful of draw calls on a tablet. Swapping in glTF models later only touches `src/view/models.ts` and `src/view/simAvatar.ts`.

## Not in this version

- Playing together needs the internet (the rest of the game still works offline). Only one household is shared at a time, and the host device has to stay awake.
- More places to walk into (the high street and the market are still off-screen outings for now).
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

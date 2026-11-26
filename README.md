# Roadtrip LiveRoad

A road-trip tour guide that rides along on your phone. You plan a trip once. While you drive, a friendly guide named Miles reads a short, fun story out loud each time you pass a town, a river or a roadside sight.

Static web app (HTML/CSS/JS) with a Google Sheet as the backend through a Google Apps Script web app. It's the same pattern as `ku-accomodation` and `isha-kc-volunteers`: JSONP reads, tabs created on first load, writes serialized with a script lock. Writes here are JSON POSTs because a trip is too big for a URL.

## What it does

- **Plan** any number of trips:
  - **Stops:** a start, an end, and any big cities you'll drive through. You can reorder or remove them, and search suggests places as you type.
  - **Interests:** history, Native American heritage, culture, historical events, interesting facts, local stories, inventions, famous businesses, food, nature and more. The guide leads with stories that match.
  - **Route and stops:** the app finds the driving route and every city, town, village, river crossing, museum, historic site and attraction near it. You review them on a map and untick anything to skip.
  - **Drive back:** "Also plan the drive back" saves the reverse trip too, with the same stops and notes. Any saved trip also has a **Plan the drive back** button.
- **Drive**:
  - **Start:** tap Start the trip and allow location. The screen stays on.
  - **Narration:** as you near each stop, the guide reads its note aloud. Stops ahead get a short lead so the story lands as you pass. When several are close together, villages give way to bigger stories.
  - **Controls:** replay, skip and mute. Up next shows distances, and "Already heard" keeps a list you can replay.
  - **Mid-route starts:** stops already behind you are skipped quietly. The trip is marked done near the end, and progress (last mile, played stops) is saved to the sheet.
  - **Demo drive:** plays the trip without GPS, so you can try it at home.
- **Works offline on the road**: trips are cached on the phone, and the voice is the phone's own speech engine. Map tiles and new notes need a connection.

## Guide notes

- **With Claude (best):** add `ANTHROPIC_API_KEY` to the Apps Script properties. The backend writes notes 8 at a time with `claude-opus-5-5` (low effort, structured JSON output, server-side refusal fallback). It saves them to the `Note` column, reuses them for every trip that passes the same place, and writes upcoming ones while you drive. Run `testGuide()` in the editor once to check the key.
- **Without a key:** the page builds a note from the Wikipedia summary with a friendly opener and closer.
- **By hand:** type any note into the sheet. A note that's already there is never overwritten.

## Sheet tabs (created on first load)

- `Trips`: one row per trip.
  - Columns: Name, Start, Via, End, Interests (`;`-separated), Miles, Drive Hours, Status (planned / active / done), Places, Notes Ready, Started/Finished At, Last Mile, Last Seen At, Return Of (the outbound trip for a drive back), Stops JSON, Route (encoded polyline), Deleted.
  - Type `yes` in Deleted to hide a trip.
- `Places`: one row per stop per trip, in road order.
  - Columns: Place ID (OpenStreetMap id), Name, Kind (city / town / village / river / history / museum / attraction / fun / view / nature), Mile, Off Route Miles, Lat, Lng, Population, Wikipedia, Summary, Note, Note Source, Include, Played At, Plays.
  - Set Include to `no` to skip a stop.

## Setup

1. **Create the sheet.** Make an empty Google Sheet.
2. **Add the backend.** Extensions > Apps Script, delete the default code, paste `apps-script.js`, save.
3. **Optional script properties.** Project Settings > Script properties:
   - `ANTHROPIC_API_KEY` for Claude-written notes.
   - `ACCESS_KEY` for a passphrase the page must send.
4. **Deploy.** Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone. Copy the `/exec` URL.
5. **Connect the page.** Paste the URL in Settings at the bottom of the Trips tab, once on each phone or computer (it's saved in that browser). Don't commit it to `common.js` in a public repo: anyone with the URL could read and edit your trips. If you must, set `ACCESS_KEY` too.
6. **Host it.** GitHub Pages (Settings > Pages > main branch). Location needs HTTPS, which Pages gives you.

After changing `apps-script.js`, use Deploy > Manage deployments > Edit > New version.

Prefill the plan form with a link: `?from=Kansas City, MO&via=St. Louis, MO&via=Indianapolis, IN&to=Columbus, OH&name=Thanksgiving drive`.

To try it locally: `python -m http.server 8765`, then open http://localhost:8765.

## Data sources (free, no keys)

- [Photon](https://photon.komoot.io) for place search.
- [OSRM](https://project-osrm.org) for the driving route.
- [Overpass API](https://overpass-api.de) for towns and sights from OpenStreetMap.
- Wikipedia and Wikidata for summaries.
- OpenStreetMap tiles through [Leaflet](https://leafletjs.com).

The public Overpass servers can be slow at busy times. The app tries several, two queries at a time, and skips a stretch that keeps failing, then tells you so you can rebuild later.

## Notes

- **Screen and battery:** phones pause web pages when the screen turns off. Keep the app open with the screen on and the phone plugged in. The app asks the browser to keep the screen awake.
- **Safety:** the guide never asks the driver to look at anything. Passengers do the looking.
- **Privacy:** anyone with the link can read and edit trips unless you set `ACCESS_KEY`. Your live location stays on the phone. Only the last mile reached and which stops were played go to the sheet.
- **Look and feel:**
  - **Layout:** the same as the other projects: cream card on sand, Trirong headings and Inter body text, collapsible cards and chips.
  - **Colors:** highway-sign green with sunset orange.
  - **Icons:** [Lucide](https://lucide.dev) (ISC licence), in `icons.js`.

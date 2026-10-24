Project walkthrough

# FusionChef

A kitchen expiry tracker with voice and typed input. It turns the food you pick into recipes from four different cuisines and keeps a running tally of the day's calories. This page explains how it is built and how a person uses it, based on the code on `main`.

**0**npm dependencies

**3**pages

**3**API endpoints

**\~1,000**lines of code in total

**0**rows stored on the server

[Architecture](#architecture)[User workflow](#workflow)[AI flow](#ai)[Data](#data)[Dev mode](#dev)[Files](#files)[Limits](#limits)

How it is built

## A thin server, a plain front end, and the browser as the database

The Node server does two jobs: it serves the static files and it forwards model requests so the OpenRouter key never reaches the browser. Everything the user owns lives in `localStorage`.

Browser

### Front end

- Vanilla JS, no build step
- Kitchen, Nutrition and Recipe pages
- Shared helpers on `window.FC`

fetch\
JSON

Node 18+ · server.js

### Stateless server

- Serves `/public`
- `POST /api/parse`
- `POST /api/recipes`
- `GET /api/capabilities`
- Prompts, validation, retries

HTTPS\
Bearer key

External

### OpenRouter

- Chat completions API
- Free model by default
- Optional fallback models

**Browser `localStorage`** Items, saved recipes, calorie log, calorie goal and the dev-mode day offset. Per browser and per address. Nothing is synced and the server never sees it, apart from the ingredient names and typed text sent to the model.

### Server

Plain `http.createServer`. A tiny `.env` parser loads config. Static files are guarded against path traversal. The three API routes are a handler table keyed by path; errors come back as `500 {error}` so the UI can show them.

### Front end

Each page is an IIFE that reads from `FC.load`, renders with template strings and saves with `FC.save`. All model and user text goes through `FC.esc` before it reaches `innerHTML`. Styling is one CSS file with light and dark variables.

### Configuration

Set `OPENROUTER_API_KEY` to switch the AI on. Optional: `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODELS`, `OPENROUTER_AUDIO_MODEL`, `OPENROUTER_MAX_TOKENS`, `PORT`. `npm run check` makes one real parse call to verify the key.

What a person does

## From a full fridge to a logged meal

The whole loop runs in three screens. The only step that needs the network is the AI call.

Kitchen page

### Add food by voice or text

Type “two eggs and 500g chicken breast, expires Friday” or tap the mic. With no audio model configured, the mic uses the browser's speech recognition and sends the transcript down the same path as typed text. If audio upload is configured it records with MediaRecorder instead.

Server → model

### The model turns the sentence into items

`/api/parse` asks for one object per food: name, count, weight in grams and an expiry date. Relative dates like “Friday” are resolved against today's date, and anything not said stays `null`.

Browser

### Defaults fill the gaps

Missing amounts and shelf lives come from `defaults.json` (eggs become a carton of 6, milk a 1 L carton). With no match the shelf life is 7 days. Anything the user said wins, and guessed expiries are flagged so the status line tells them to check.

Kitchen page

### Cards sort themselves by urgency

Each item is a card with a countdown ring and sits in one of three lanes. The user can edit a card's name, amount and use-by date, or remove it.

**Eat now**Past date or 2 days or fewer`days ≤ 2`

**Use soon**3 to 7 days left`3 – 7`

**Plenty of time**More than a week`> 7`

Kitchen page

### Select ingredients and generate

Tapping cards selects them and a bottom bar appears. **Generate** opens a dialog and calls `/api/recipes` with the chosen names and quantities. The server asks for four recipes, each from a different cuisine, and only returns them if at least two pass the sanity checks.

Recipe dialog

### Pick favourites and save

Each result shows title, cuisine, summary, calories, total time and servings. The user ticks the ones to keep, or taps *Generate more* to ask again. Saved recipes get an id and a saved-on date and are stored in the browser.

Nutrition page

### Track the day

A calorie ring shows kcal eaten against the goal (default 2000, minimum 500), with protein, carbs and fat bars. Meals can be logged by hand. Saved recipes appear as tiles with their macros.

Recipe page

### Cook, then log it

A tile opens `/recipe.html?id=…` in a new tab: ingredients and method on the left, per-serving nutrition and timings on the right. Entering servings eaten and pressing **Add to today's calories** writes a log entry scaled by that number. The Nutrition tab picks it up through the `storage` event without a reload.

The AI flow

## Ask for JSON, then do not trust it

Free models are slow to answer, rate limited and sometimes wrong, so the server wraps every call in the same ladder: try a model, try it again in a looser mode, then move to the next model. Nothing reaches the UI until it passes validation.

### Parse: text to items

Prompt contains today's date and rules: singular lowercase names, grams for kg/oz/lb, 1 litre of liquid = 1000 g, a dozen = 12, never invent a quantity or expiry. Schema: array of `{name, count, weight_g, expiry}` with only `name` required.

**Validator:** keep entries that have a non-empty string name. An empty list fails the attempt.

### Recipes: items to four ideas

Prompt asks for real dishes, one per cuisine, proper cooking methods, at least four steps and realistic nutrition per serving. Pantry staples (oil, salt, spices, flour, stock) are assumed available.

**Validator:** `sane()` per recipe, and at least two must pass.

### The attempt ladder (`askJSON`)

*1*

**Main model, structured output**Sends a `json_schema` `response_format`, low reasoning effort (so reasoning models do not spend the whole token budget thinking) and temperature 0.4.

*2*

**Same model, plain text**Used when the model rejects schemas, returns an empty reply or fails validation. Models that reject JSON mode are remembered and skip step 1 from then on.

*3*

**Next fallback model**Repeats steps 1 and 2 for each id in `OPENROUTER_FALLBACK_MODELS`, in order.

*✕*

**Give up**Returns one error listing every attempt. The UI shows it in the status line or the dialog.

Every reply is parsed leniently: code fences are stripped and the longest valid JSON value in the text wins, so a stray “\[1\]” in a preamble cannot beat the real answer. Each attempt logs `[ai] ok: <model>` or `[ai] failed: <model>: <reason>`.

### Transport retries

Inside each attempt, `post()` retries up to four times with exponential backoff on HTTP 429, 502, 503 and 504 and on network errors. It honours `Retry-After` (capped at 20 seconds) and each request times out after 180 seconds. Errors OpenRouter hides inside a 200 response are surfaced too.

### Voice path

`/api/capabilities` tells the page whether an audio model is set. If not, the browser transcribes and the text goes to the normal parse. If it is, audio is sent as base64 to that one model, and a missing audio model gives a clear error rather than a silent failure.

### What makes a recipe “sensible”

| Check | Rule |
| --- | --- |
| Completeness | Has a title, at least 3 steps and at least 2 ingredients |
| Calories | Calories, protein, carbs and fat are all numbers, and calories are between 50 and 1800 |
| Macro maths | 4 × protein + 4 × carbs + 9 × fat must land within 50% to 160% of the stated calories |
| Plausibility | 1 to 12 servings, prep at most 240 minutes, cook at most 480 minutes |
| Uses your food | At least half the ingredient lines mention something the user picked or a common pantry item |
| Overall | Fewer than two recipes passing means the attempt fails and the ladder continues |

Where things live

## Data and storage

All writes go through `FC.save`, which wraps `localStorage` in a try/catch so a blocked store never crashes a page.

| Key | Holds | Written by |
| --- | --- | --- |
| `fc.items` | Kitchen items | Kitchen page |
| `fc.recipes` | Saved recipes with id and saved-on date | Recipe dialog, deleted from Nutrition |
| `fc.log` | Calorie log entries: date, name, kcal, protein, carbs, fat | Nutrition and Recipe pages |
| `fc.goal` | Daily calorie goal | Nutrition page |
| `fc.dayoffset` | Demo days added to today | Dev mode |
| `fc.dev` | Whether dev mode is on | Kitchen page (set directly) |

### An item

```
{
  id, name, count, weight_g,
  pack,     // "carton of 6": display label
  food,     // matched row in foods.json
  added, expires,  // YYYY-MM-DD
  guessed   // true if expiry was defaulted
}
```

The `pack` label replaces the quantity text until the user edits the amount.

### Two small data files

- **`defaults.json`** (20 entries): pack sizes, unit weights and shelf lives such as eggs 21 days, milk 7, chicken 2.
- **`foods.json`** (20 entries): kcal per 100 g and unit weight. Names are matched by token overlap, so “free range eggs” still finds “egg”. This gives each card its “≈ kcal” estimate.

Both are plain JSON that can be extended without touching code.

For demos

## Developer mode

Tick **Developer mode** in the Kitchen footer to show a **Next day ▶** button. Each press adds a day to a stored offset, so cards drift from *Plenty of time* to *Use soon* to *Eat now* in front of an audience. **Reset** clears the offset, and turning dev mode off also resets it.

The offset is applied in one place. The code calls `FC.today()` and `FC.now()` instead of `new Date()`, so the Nutrition page's “today” and the calorie log follow the demo date as well. The server's prompt still uses the real date.

Orientation

## Where to look in the repo

```
server.js          server, routes, AI calls
public/
  index.html       Kitchen
  nutrition.html   Calories and saved recipes
  recipe.html      One recipe (?id=)
  js/common.js     storage, dates, matching, api()
  js/main.js       Kitchen logic
  js/nutrition.js  Nutrition logic
  js/recipe.js     Recipe logic
  css/style.css    all styling, light + dark
  data/            foods.json, defaults.json
test/              fake model servers
```

### Testing

`npm test` starts the server against fake OpenRouter servers and checks request shape, schema and model fallback, the “no audio model” error, and that nonsense recipes are rejected. It does not test a real model, a browser or the microphone, and there is no committed UI test.

Code style: 2-space indent, double quotes, semicolons, no dependencies.

Honest edges

## Known limits

- **Data is browser-only**No sync, backup or accounts. Clearing site data, or opening another browser or address, starts from empty.
- **Never verified against a real key from the build environment**Free models get rate limited (about 20 requests a minute), return empty replies or are retired. The `[ai]` log lines are the first place to look.
- **Small food database**Only 20 starter foods have calorie estimates, so many cards show no kcal figure.
- **Fixed macro targets**Nutrition bars use a 25 / 50 / 25 split of protein, carbs and fat and cannot be edited yet.
- **Cuisine choice is not in the UI**The recipe endpoint accepts a list of cuisines, but the Kitchen page does not send one, so the model picks a varied mix.
- **Legacy code remains**Unused Vertex AI and AI Studio paths still sit in `server.js` and are candidates for deletion.
- **Speech depends on the browser**The browser option works best in Chrome on localhost, and Safari needs Dictation turned on.

Based on FusionChef `main` (README and CLAUDE.md included). Describes the OpenRouter version only.
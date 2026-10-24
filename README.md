# FusionChef

Track what's in your kitchen and when it expires, add items by voice or text, turn the ones you pick into recipes from different cuisines, and keep an eye on the day's calories.

## Run (Mac)

Needs Node 18+ (`brew install node`) and Google Chrome.

```
cp .env.example .env   # add your OPENROUTER_API_KEY (free at https://openrouter.ai/keys)
npm run check          # one real call to confirm the key and model work
npm start              # open http://localhost:3000 in Chrome
```

## Configuration (`.env`)

| Variable | What it does |
| --- | --- |
| `OPENROUTER_API_KEY` | Your OpenRouter key. Stays on the server, never sent to the browser. |
| `OPENROUTER_MODEL` | Model id from openrouter.ai/models. Defaults to the free `nvidia/nemotron-3-super-120b-a12b:free`. |
| `OPENROUTER_FALLBACK_MODELS` | Comma-separated ids tried in order if the main model fails or is rate-limited. |
| `OPENROUTER_AUDIO_MODEL` | Optional. Leave unset: voice uses the browser's speech-to-text instead. |
| `OPENROUTER_MAX_TOKENS` | Optional, default 8192. |
| `PORT` | Optional, default 3000. |

Free models are rate-limited (20 requests/minute; 50/day, or 1000/day once you have bought 10+ credits) and come and go, so if a model stops working, swap in another `:free` id. The server logs `[ai] ok: <model>` or `[ai] failed: <model>: <reason>` for each attempt, which shows which model actually answered.

## Pages

- **Kitchen** (`/`): expiry tracker with cards that move from "Plenty of time" to "Use soon" to "Eat now". Add items by mic or typing, edit or remove them, select some and generate recipes.
- **Nutrition** (`/nutrition.html`): daily calorie ring and macros, manual logging, saved recipes.
- **Recipe** (`/recipe.html?id=…`): opens from a saved recipe. Method on the left, nutrition on the right, and a button to log the calories once cooked.

## How it works

- **Voice:** the mic uses your browser's speech recognition (Chrome, with the microphone allowed). The transcript is sent to `POST /api/parse`, which asks the model for `{name, count, weight_g, expiry}` per item. Typed text takes the same route. If the mic says "service-not-allowed", use Chrome (not Brave/Arc/Edge) at `localhost`, or turn on Dictation if you use Safari. Typing always works.
- **Smart defaults:** anything you don't say is filled in from `public/data/defaults.json`: eggs are a carton of 6, milk a 1 L carton, a chicken leg 250 g, plus typical pack sizes and shelf lives. What you do say always wins. Edit the file to change them.
- **Edit:** each card has an edit button for name, amount and use-by date.
- **Recipes:** `POST /api/recipes` asks for 4 recipes from different cuisines. Replies must be valid JSON and are checked for sense (enough steps, calories that match the macros, plausible times, ingredients mostly from your list or pantry). If too few pass, the server retries without structured output, then with the next fallback model. Rate-limit and server errors retry with backoff.
- **Calories:** per-item calories come from matching names against `public/data/foods.json` (`[{ "name", "kcal_per_100g", "unit_g" }]`). The file is a small starter list; extend it as needed.

## Developer mode (for demos)

Tick **Developer mode** at the bottom of the Kitchen page. A **Next day ▶** button moves "today" forward one day so you can show cards moving between lanes without waiting. **Reset** returns to the real date. The Nutrition page follows the demo date.

## Where data lives

Items, saved recipes, the calorie log and your goal are stored in your browser's `localStorage` (keys starting `fc.`). They are per browser and per address, are not synced, and are lost if you clear site data. The server stores nothing. Only the text you enter and ingredient names are sent to OpenRouter.

## Tests

`npm test` runs the server against fake OpenRouter servers (request shape, structured-output fallback, model fallback, rejection of nonsense recipes). It does not exercise a real model or the microphone.

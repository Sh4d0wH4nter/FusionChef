# FusionChef

Track what's in your kitchen and when it expires, add items by voice, turn the ones you pick into recipes from different cuisines, and keep an eye on the day's calories.

## Run

```
cp .env.example .env   # set OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL)
npm run check          # one real call to confirm the key and model work
npm start              # http://localhost:3000
```

### OpenRouter (default)

Needs Node 18+ (`brew install node` on Mac) and a key from https://openrouter.ai/keys. In `.env`:

- `OPENROUTER_API_KEY`: your key.
- `OPENROUTER_MODEL`: any model id from openrouter.ai/models (default `nvidia/nemotron-3-super-120b-a12b:free`).
- `OPENROUTER_FALLBACK_MODELS`: optional comma-separated ids tried if the main model fails or is rate-limited.
- `OPENROUTER_AUDIO_MODEL`: optional audio-capable model. Gemma on OpenRouter has no audio input, so by default the mic uses your browser's speech recognition (Chrome) and the transcript goes to the model.

Replies are validated as JSON; if a model rejects structured output or returns something unusable, the server retries without the schema, then moves to the next fallback model (429/5xx are retried with backoff).

**Not tested against a real OpenRouter key** (built without one; `npm test` uses a fake server). Browser audio is `webm`, which many audio models on OpenRouter may reject (they prefer wav/mp3); if so, unset `OPENROUTER_AUDIO_MODEL`.

### Vertex / AI Studio (legacy, kept for reference)

### Vertex AI (uses Google Cloud credits)

Common setup (Mac, Terminal):

```
brew install --cask gcloud-cli        # or the installer from cloud.google.com/sdk; then open a NEW terminal
gcloud --version                      # must print a version; if "command not found", set GCLOUD_PATH in .env
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable aiplatform.googleapis.com
```

Check that billing is linked to the project that holds your trial credits. Then pick one option below. Run `npm run check` after editing `.env`: it makes one real call and prints what came back.

**Option 1: Gemma 4 E4B on your own endpoint (what this project is aimed at).** E4B is not offered as a pay-per-token API anywhere on Vertex, so you deploy it and pay for the GPU by the hour out of your credits.

1. Console, Vertex AI, Model Garden, search "Gemma 4", open **gemma-4-e4b-it**, click **Deploy**. Pick the smallest GPU it offers (one L4 or T4 class card is enough for E4B), region `us-central1`, and a **dedicated public endpoint**.
2. New or free-trial accounts often have **0 GPU quota**. If deploy fails with a quota error, request "Custom model serving" GPU quota for that region (IAM & Admin, Quotas). Google may require the account to be upgraded from free trial (credits stay) before it grants GPU quota.
3. When the endpoint is Ready, open it (Vertex AI, Online prediction, Endpoints) and copy its ID and, if shown, the dedicated DNS name into `.env`: `VERTEX_ENDPOINT_ID`, `VERTEX_ENDPOINT_DNS`.
4. `npm start`.

> **Undeploy when you stop.** A deployed endpoint bills every hour whether or not you use it (roughly a few dollars a day for one small GPU; check the price shown at deploy time). Vertex AI, Online prediction, Endpoints, open it, **Undeploy model**, then delete the endpoint. A forgotten endpoint will eat the $300.

**Option 2: serverless Gemma, no GPU.** Leave `VERTEX_ENDPOINT_ID` unset and set `VERTEX_LOCATION=global` and `VERTEX_MODEL=gemma-4-26b-a4b-it-maas`. This is Google's per-token Gemma 4 26B service (labelled experimental). It is not E4B, and it has no audio, so the mic falls back to your browser's speech recognition. Cheaper to leave idle, because nothing runs when you are not using it.

**Option 3: Gemini on Vertex.** Default `VERTEX_MODEL=gemini-2.5-flash` if your project can use it.

Use `/api/capabilities` to see the active backend and whether audio is on.

#### Honest status

Developed without access to a real Vertex project. Tested only against a fake endpoint (`npm test`): URL shape, JSON-schema attempt then plain-prompt fallback, retries on 429/503, audio request variants. **Not verified against a real Gemma 4 E4B deployment**: the exact URL your endpoint accepts (`/chat/completions` on the dedicated DNS vs `:rawPredict`, switchable with `VERTEX_ENDPOINT_API`), whether the serving container accepts the `model` field, and whether it decodes browser `audio/webm`. If voice fails, set `VERTEX_ENDPOINT_AUDIO=0`; typed input and browser speech recognition still go through Gemma. Send the error text from `npm run check` or the server log and it can be fixed quickly.

Needs Node 18+, no npm dependencies. Open it in Chrome so the microphone works (localhost is allowed).

## Pages

- **Kitchen** (`/`): expiry tracker, voice or typed input, select items and generate recipes.
- **Nutrition** (`/nutrition.html`): daily calorie ring and macros, manual logging, saved recipes.
- **Recipe** (`/recipe.html?id=…`): opens in a new tab from a saved recipe. Method on the left, nutrition and facts on the right, and a button to log the calories once cooked.

## How it works

- Voice audio and typed text go to `POST /api/parse`, which asks Gemma to return `{name, count, weight_g, expiry}` for each item. The key stays on the server.
- Recipes come from `POST /api/recipes`.
- Items, saved recipes and the calorie log live in the browser's `localStorage` on your computer.
- Calories per item come from matching the name against `public/data/foods.json` (`[{ "name", "kcal_per_100g", "unit_g" }]`). The file there now is a small placeholder; replace it with the real database.
- The server picks a Gemma model from the ones your key can call (usually `gemma-4-31b-it`; override with `GEMMA_MODEL`). For audio it looks for a small Gemma model that accepts audio (see `/api/capabilities`), or you can set `GEMMA_AUDIO_MODEL`. If none is available the mic falls back to the browser's speech recognition, and Gemma still parses the text.


Presentation: https://docs.google.com/presentation/d/1IwMnK-nBsf1YgOa2XDsK0K4OxPp7rUfnROv40LG849Y/edit?usp=sharing

**Mic says "service-not-allowed"?** Browser speech recognition needs Google Chrome (not Brave/Arc/Edge) opened at `http://localhost:3000`, with the microphone allowed for the site. Safari needs Dictation turned on in System Settings > Keyboard. Typing items always works.

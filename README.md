# MedicaLogic

**Paste. Verify. Learn.** MedicaLogic helps you spot AI-spread health misinformation. It checks health claims from social media against real medical research (PubMed and MedlinePlus) and explains the result in plain language, in English and Arabic.

Built by MediLab #7062 for the 2026 NYAS Junior Academy Challenge.

## What it does

- **AI Misinformation Checker:** paste a health claim or a social media caption and get a verdict (Supported, Divergent, Not supported, or Insufficient evidence), a short summary, and real PubMed sources.
- **Manipulation Detector:** scores how pushy the wording is (0 to 100), based on words like "guaranteed," "miracle," or "doctors don't want you to know."
- **Educator Resources:** debunked viral claims, ready to use as classroom examples.
- **English and Arabic:** every page has an Arabic version.

## What's in this project

```
medicalogic/
├── frontend/      the website (HTML, CSS, JavaScript)
└── backend/
    ├── server/    the server that checks claims (Node.js)
    ├── myths.json the team's verified claim database
    └── *.py       test and data-checking scripts (Python)
```

---

# How to run it on your computer (complete beginner guide)

These steps are for **Windows**. Mac notes are in *italics*. You only need to do Part 1 once.

## Part 1: One-time setup

### Step 1: Install VS Code (the code editor)

1. Go to **https://code.visualstudio.com**.
2. Click the big blue **Download for Windows** button.
3. Open the downloaded file, click **I accept the agreement**, then keep clicking **Next**.
4. On the "Select Additional Tasks" screen, tick **Add "Open with Code" action** (both boxes) and make sure **Add to PATH** is ticked.
5. Click **Install**, then **Finish**.

*Mac: download, open the .zip, and drag Visual Studio Code into your Applications folder.*

### Step 2: Install Node.js (runs the server)

1. Go to **https://nodejs.org**.
2. Download the **LTS** version (the one marked "Recommended").
3. Open the file and click **Next** through every screen, keeping all the default options. Click **Install**, then **Finish**.
4. **Restart your computer** (or at least close and reopen VS Code) so it can find Node.

### Step 3: Download the project

**Option A, no GitHub account needed:**

1. On this GitHub page, click the green **Code** button, then **Download ZIP**.
2. Find the zip in your **Downloads** folder, right-click it, and choose **Extract All…**, then **Extract**.
3. You now have a folder called `medicalogic-main`. You can move it anywhere you like (for example, your Documents folder).

**Option B, if you use Git:** `git clone` this repository.

### Step 4: Open the project in VS Code

1. Open **VS Code**.
2. Click **File** (top left), then **Open Folder…**
3. Choose the `medicalogic-main` folder (the one that contains `frontend` and `backend`) and click **Select Folder**.
4. If VS Code asks **"Do you trust the authors of the files in this folder?"**, click **Yes, I trust the authors**.
5. On the left you'll see the **Explorer** with the `backend` and `frontend` folders. Click the small arrows to open them.

### Step 5: Get your own free AI key (Groq)

The server uses Groq's free AI service. Each person needs their own key.

1. Go to **https://console.groq.com** and sign in (signing in with Google is easiest).
2. In the left menu, click **API Keys**, then **Create API Key**.
3. Give it any name (for example, `medicalogic`) and click **Submit**.
4. **Copy the key right away** (it starts with `gsk_`). You won't be able to see it again.

> Keep this key private. Don't post it in chats or upload it to GitHub. If it ever leaks, delete it on the Groq website and make a new one.

### Step 6: Put your key in the project

1. In VS Code's Explorer, open `backend`, then `server`.
2. Right-click the **`server`** folder and choose **New File…**
3. Type exactly **`.env`** (a dot, then env, nothing else) and press **Enter**.
4. In the new empty file, type `GROQ_API_KEY=` and paste your key right after the `=` with no spaces. It should look like this:
   ```
   GROQ_API_KEY=gsk_yourKeyHere
   ```
5. Press **Ctrl + S** to save (*Mac: Cmd + S*).

(There's an example file called `.env.example` in the same folder if you want to compare.)

### Step 7: Install the server's packages

1. In VS Code's top menu, click **Terminal**, then **New Terminal**. A panel opens at the bottom.
2. Click inside the terminal and type this, then press **Enter**:
   ```
   cd backend\server
   ```
   *(Mac: `cd backend/server`)*
3. Now type this and press **Enter**:
   ```
   npm install
   ```
4. Wait until it finishes and you can type again. A new `node_modules` folder appears. That's normal.

> **Error saying "running scripts is disabled on this system"?** Type `npm.cmd install` instead. It does the same thing.

### Step 8: Install the Live Server extension (opens the website)

1. On VS Code's far-left bar, click the **Extensions** icon (four small squares).
2. In the search box, type **Live Server**.
3. Click the one by **Ritwick Dey**, then click **Install**.

Setup is done.

## Part 2: Every time you want to use it

### Step 1: Start the server

1. Open the project in VS Code (**File → Open Folder…** if it isn't open already).
2. Open a terminal (**Terminal → New Terminal**).
3. Type these two lines, pressing **Enter** after each:
   ```
   cd backend\server
   node server.js
   ```
4. You should see:
   ```
   MedicaLogic server v2 running on http://localhost:5000
   ```
5. **Leave this terminal open.** The website only works while the server is running.

### Step 2: Open the website

1. In the Explorer, open the `frontend` folder.
2. Right-click **`index.html`** and choose **Open with Live Server**.
3. Your browser opens the MedicaLogic home page.

### Step 3: Try it

1. Go to **AI Misinformation Checker** (in the top menu).
2. Paste a claim, for example:
   - `Smoking increases the risk of lung cancer.` (should be **Supported**)
   - `Vitamin C prevents colds.` (likely **Divergent**: the evidence is mixed)
   - `Detox drinks cleanse your liver, guaranteed!` (should be **Not supported**)
3. Click **Verify Claim** and wait up to about 20 seconds.
4. Click **EN | AR** at the top right to switch to Arabic. Arabic pages are mirrored (right to left) on purpose.

### Step 4: Stop the server when you're done

Click inside the terminal and press **Ctrl + C**. To start again later, repeat Part 2.

## Fixing common problems

| What you see | What to do |
|---|---|
| "Can't reach the MedicaLogic server" on the website | The server isn't running. Do Part 2, Step 1, and keep that terminal open. |
| `'node' is not recognized` | Node.js isn't installed, or VS Code was open while you installed it. Install Node (Part 1, Step 2), then close and reopen VS Code. |
| `Cannot find path ...backend\server` | Your terminal is in the wrong folder. Make sure you opened the folder that contains `frontend` and `backend` (Part 1, Step 4). |
| `Cannot find package 'express'` | You skipped `npm install`. Do Part 1, Step 7. |
| "running scripts is disabled on this system" | Use `npm.cmd install` instead of `npm install`. |
| Invalid API key / 401 error | Check your `.env` file: it must be named exactly `.env`, sit inside `backend\server`, and contain `GROQ_API_KEY=` followed by your key with no spaces or quotes. Save it and restart the server. |
| "Too many requests" or rate limit | Groq's free plan has a per-minute limit. Wait a minute and try again. |
| `EADDRINUSE` / port 5000 already in use | The server is already running in another terminal. Use that one, or close it with Ctrl + C first. |
| "Open with Live Server" doesn't appear | Install the extension (Part 1, Step 8), then reload VS Code. |

## For the research team: test scripts (optional)

These need **Python** from **https://www.python.org/downloads** (on the first install screen, tick **Add python.exe to PATH**). Open a *second* terminal while the server is running, then:

```
cd backend
py validate_myths.py              # checks myths.json for mistakes
py evaluate.py --set core         # tests the 5 core claims against the running server
```

*(Mac: use `python3` instead of `py`.)*

More technical details about the server are in [`backend/server/API.md`](backend/server/API.md).

## Hosting on Vercel (for whoever maintains the live site)

The repo is ready for Vercel's free plan: `vercel.json` serves the `frontend` folder as the website and runs the server from `api/index.js` (the same code as `backend/server`).

In the Vercel project's **Settings → Environment Variables**:

| Name | What to put |
|---|---|
| `GROQ_API_KEY` | the Groq key (required) |
| `UNANSWERED_KEY` | any secret word; then the unanswered list is at `/api/unanswered?key=thatword` |

To keep the unanswered-claims list permanently, connect a free **Upstash Redis** database from the project's **Storage** tab. Vercel adds its settings automatically; redeploy afterwards. Every push to GitHub updates the live site automatically.

## Disclaimer

MedicaLogic summarizes published research for education. It is not medical advice. Talk to a health professional about your own health.

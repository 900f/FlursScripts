# Flurs Script Hub — Vercel Deployment Guide

Scripts are served at `flurs.xyz/api/<hash>.lua`  
Browsers get **403 Forbidden**. Roblox executors get the raw Lua.

---

## Folder Structure

```
flurs-vercel/
├── api/
│   ├── script.js       ← serves .lua files to executors
│   └── admin.js        ← save/delete scripts (password protected)
├── public/
│   ├── index.html
│   ├── script.js
│   ├── styles.css
│   └── images/         ← copy your images folder here
├── vercel.json
├── package.json
└── README.md
```

---

## Step 1 — Install Vercel CLI

```bash
npm install -g vercel
```

---

## Step 2 — Create a Vercel Account

Go to https://vercel.com and sign up (free). Connect your GitHub account when prompted.

---

## Step 3 — Enable Vercel KV (the script database)

1. Go to https://vercel.com/dashboard
2. Click **Storage** in the left sidebar
3. Click **Create Database** → choose **KV**
4. Name it anything (e.g. `flurs-scripts`)
5. Click **Create**
6. You'll see connection details — you don't need to copy anything, Vercel links it automatically in the next step

---

## Step 4 — Deploy the project

Open a terminal in the `flurs-vercel/` folder and run:

```bash
vercel
```

Follow the prompts:
- **Set up and deploy?** → Yes
- **Which scope?** → Your account
- **Link to existing project?** → No
- **Project name?** → `flurs-script-hub` (or anything)
- **In which directory is your code?** → `./` (just press Enter)
- **Want to modify settings?** → No

It will deploy and give you a URL like `https://flurs-script-hub.vercel.app`

---

## Step 5 — Link the KV database to your project

```bash
vercel env pull
```

Then in the Vercel dashboard:
1. Go to your project → **Settings** → **Environment Variables**
2. Vercel KV adds its own variables automatically when you link it in the Storage tab
3. In the Storage tab, click your KV database → **Connect to Project** → select your project

---

## Step 6 — Set your admin password as an environment variable

In the Vercel dashboard → your project → **Settings** → **Environment Variables**:

| Name             | Value          | Environment       |
|------------------|----------------|-------------------|
| `ADMIN_PASSWORD` | `your-password-here` | Production, Preview, Development |

Then redeploy:
```bash
vercel --prod
```

---

## Step 7 — Add your custom domain

1. Vercel dashboard → your project → **Settings** → **Domains**
2. Add `flurs.xyz`
3. Vercel shows you DNS records to add — go to wherever you bought the domain and add them
4. Wait ~5 minutes for DNS to propagate

---

## Using the Admin Panel

1. Go to `https://flurs.xyz/#admin`
2. Enter your password
3. Paste Lua code → click **Generate & Save**
4. Copy the loadstring: `loadstring(game:HttpGet("https://flurs.xyz/api/abc123.lua", true))()`
5. Put that loadstring in any script card on your site

---

## How the browser blocking works

When someone visits `flurs.xyz/api/abc123.lua` in Chrome/Firefox/etc:
- Their browser sends a `User-Agent` like `Mozilla/5.0 Chrome/...`
- The server detects this and returns `403 Forbidden`
- They cannot read the script

When a Roblox executor calls `HttpGet`:
- It sends a different User-Agent (or none at all)
- The server serves the raw Lua text
- The executor runs it normally

---

## Troubleshooting

**"KV not found" errors** → Make sure you linked the KV database to your project in the Storage tab and redeployed.

**Admin panel shows "Unauthorized"** → Check that `ADMIN_PASSWORD` env var is set and matches what you type.

**Scripts not loading in-game** → Make sure you're using the full URL including `https://` and the `.lua` extension.

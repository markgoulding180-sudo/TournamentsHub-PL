# Vercel Deployment Setup

## Step 1: Install Vercel CLI
```bash
npm i -g vercel
```

## Step 2: Login to Vercel
```bash
vercel login
```
Follow the prompts to authenticate.

## Step 3: Deploy
From the project root folder:
```bash
vercel
```

First time setup:
- Vercel will ask to link to a project
- Choose "Create new project"
- Name it: gb-fantasy

## Step 4: Set Environment Variables
In your Vercel dashboard (https://vercel.com/dashboard):
1. Click your gb-fantasy project
2. Go to **Settings** → **Environment Variables**
3. Add these 3 variables:

| Name | Value |
|------|-------|
| SUPABASE_URL | https://your-project.supabase.co |
| SUPABASE_KEY | your-anon-key |
| SUPABASE_SECRET | your-service-role-key |

4. Click **Save**
5. Redeploy: `vercel --prod`

## Step 5: Your Site is Live
Vercel will give you a URL like:
`https://gb-fantasy.vercel.app`

## Free Limits (More than enough)
- **Builds**: 6,000 minutes/month (20x Netlify)
- **Function calls**: 10,000/day
- **Bandwidth**: 100GB/month
- **Never sleeps**: Always online

## Redeploy After Changes
```bash
vercel --prod
```

Or connect GitHub for auto-deploy on every push.

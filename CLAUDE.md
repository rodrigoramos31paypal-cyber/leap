# LEAP — Project memory

## Deployment (ALWAYS DO THIS)

After completing any code change in this project, **always provide the commands to push the
update to GitHub and Vercel**, and run them when appropriate.

- Remote: `origin` → https://github.com/rodrigoramos31paypal-cyber/leap.git
- Production branch: `main`
- Vercel auto-deploys on every push to `main` (GitHub → Vercel integration), so a `git push`
  is what triggers the Vercel deployment — there is no separate deploy step needed.

Standard sequence after a change:

```bash
git add -A
git commit -m "<concise message>"
git push origin main   # this also triggers the Vercel production deploy
```

Always surface these commands to Rodrigo at the end of a change (even if just as a reminder),
and offer to run them.

## Stack notes

- Next.js (App Router) + TypeScript, Tailwind, Supabase.
- Type check before pushing: `npm run type-check` (or `npx tsc --noEmit`).
- Dashboard lives at `app/app/dashboard/page.tsx`. Promo banners: `components/promo-carousel.tsx`.

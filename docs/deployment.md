# Deploy a pilot

Use a private repository accessible to both hosts. Choose the free plans explicitly and confirm the project is eligible for Vercel Hobby before deploying. Use provider subdomains. Test with synthetic students before importing a real roster. [Vercel Hobby](https://vercel.com/docs/plans/hobby)

1. Create a Neon Free PostgreSQL project. Obtain the direct TLS connection string for migrations and the pooled TLS string for the running API. Keep both in provider secret storage. [Neon pooling](https://neon.com/docs/connect/connection-pooling)
2. Create a Vercel Next.js project rooted at apps/web. Reserve its stable HTTPS origin. Create a Render Free Node web service rooted at apps/api. Select Node 24.12 or newer. Set PUBLIC_ORIGIN on Render to the exact stable frontend origin and DATABASE_URL to the pooled URL. Use NODE_ENV=production. Set API_URL on Vercel to the HTTPS Render origin.
3. From apps/api on an operator machine with DATABASE_URL set to the direct Neon URL, run `npm ci`, `npm run db:migrate` and `npm run build`. Set ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_DISPLAY_NAME for the initial `npm run db:seed` command. Keep bootstrap credentials out of frontend settings and build logs.
4. For Render, build with `npm ci --include=dev && npm run build` and start with `npm start`. For Vercel, use the Next.js defaults and redeploy after setting API_URL so the same-origin rewrite is compiled into the frontend. If migrating a later release, apply its versioned migrations before promoting the frontend and API.
5. Open the Vercel site in a fresh browser. Verify a staff login, handout, student activation, logout, PIN login, and saved quiz answer. Verify authenticated responses bypass shared caches. Test a timed-out attempt after inactivity and confirm it appears correctly in monitoring and exports.

The Render free service sleeps after idle periods and takes time to wake. Measure startup and database reconnect delays from a phone and approve the observed pilot behavior before announcing a live event. Use the restore rehearsal in operations.md before importing a real roster. [Render free services](https://render.com/docs/free)

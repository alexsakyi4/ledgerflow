# Publish LedgerFlow on Render

This Blueprint publishes the frontend and API together at one public URL and creates a PostgreSQL database. The app uses same-origin cookie authentication. No demo account is seeded in production; visitors register and create their own company.

## One-time prerequisites
- A GitHub account (the repository may be private).
- A Render account connected to GitHub.

## Publish
1. Upload the contents of this project to a GitHub repository. Keep `render.yaml` at the repository root. Do not upload `.env` files, passwords, or tokens.
2. In Render, choose **New → Blueprint** and connect that repository.
3. Review the Blueprint resources and apply them. It creates a public web service and PostgreSQL database using Render's free plans.
4. Wait for the first build and deployment to complete. Open the `ledgerflow-public` service and copy its `onrender.com` URL; that is the link to share.
5. Open the link, select **Create account**, register, then create your company.

## Free-plan limitations
- Free Render web services can sleep after 15 minutes without traffic; the first visit after sleep may take about a minute to wake.
- Free Render PostgreSQL expires 30 days after creation. Upgrade the database before then to keep the service and data. Do not store real accounting data on the temporary free database.

Render documents the current free-service limitations here: https://render.com/docs/free

## Before using real business data
Upgrade to a persistent paid PostgreSQL plan, configure backups, review user-registration policy, and set `CLIENT_URL` and `PUBLIC_APP_URL` to the service URL in Render's environment settings. Add SMTP and Stripe credentials only when you are ready to configure those services. Change all default/demo secrets and use a custom domain if desired.

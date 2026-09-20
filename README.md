# ZAIREN Portfolio

Independent black-and-gold portfolio website for Zairen's video editing, mentorship, and eBook work.

## Included

- Responsive public portfolio
- Faceless hero portrait
- Private email/password editor at `/admin.html`
- Editable introduction and contact details
- Add, edit, order, and delete portfolio items
- R2 uploads for images, short videos, and PDFs up to 25 MB
- D1 database for content, administrator, and sessions
- GitHub Actions deployment workflow

## Free Cloudflare deployment

1. Create a free Cloudflare account.
2. Install dependencies with `npm install`.
3. Sign in with `npx wrangler login`.
4. Create resources:
   - `npx wrangler d1 create zairen-portfolio-db`
   - `npx wrangler r2 bucket create zairen-portfolio-media`
5. Copy the D1 database ID into `wrangler.jsonc`.
6. Initialize the database with `npm run db:init`.
7. Create a private setup token: `npx wrangler secret put SETUP_TOKEN`.
8. Deploy with `npm run deploy`.
9. Visit `/admin.html`, enter the setup token, your private administrator email, and a new password of at least 10 characters.

Never commit the setup token, Cloudflare API token, or administrator password.

## Automatic GitHub deployment

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

After the Cloudflare resources and `SETUP_TOKEN` are configured, pushes to `main` deploy automatically.

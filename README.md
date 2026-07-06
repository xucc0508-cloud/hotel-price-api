# Hotel Price API

Minimal Node.js 20 and Express API.

## Development

```bash
pnpm install
pnpm dev
```

The server listens on port `3000`.

## Health check

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2026-07-04T00:00:00.000Z"
}
```

## Production

Create the environment file and start with PM2:

```bash
cp .env.example .env
chmod +x start.sh deploy.sh
./start.sh production
```

For subsequent deployments:

```bash
bash deploy.sh
```

Install the Nginx configuration:

```bash
sudo cp nginx/hotel-price-api.conf /etc/nginx/sites-available/hotel-price-api
sudo ln -s /etc/nginx/sites-available/hotel-price-api /etc/nginx/sites-enabled/hotel-price-api
sudo nginx -t
sudo systemctl reload nginx
```

The default deployment process is manual and runs entirely on the server:

```bash
cd /home/ubuntu/hotel-api
bash deploy.sh
```

The optional GitHub Actions workflow does not use SSH. It requires a GitHub
self-hosted runner installed directly on the production server with the
`hotel-api` label. A push to `main` then runs the same local `bash deploy.sh`
command.

## Admin provider sync framework

Protected admin APIs are mounted under `/admin`.

```text
POST /admin/login
GET  /admin/dashboard
GET  /admin/providers
POST /admin/providers/:provider/login
POST /admin/providers/:provider/test
POST /admin/providers/:provider/sync
POST /admin/providers/:provider/disable
POST /admin/sync/all
GET  /admin/sync/jobs
GET  /admin/sync/logs
```

Supported provider keys:

- `IHG`
- `Marriott`
- `Hilton`
- `Hyatt`
- `Accor`

Credentials are never logged and are encrypted with AES-256-GCM before being
stored in the local runtime data store. This framework does not bypass CAPTCHA,
MFA, or hotel website risk controls. Providers without an official API/OAuth
connection are marked as pending manual authorization and must not be presented
as real synced prices.

# Resolve Redirect - Cloudflare Worker

A Cloudflare Worker that resolves URL redirects and returns the final destination URL.

## Features

- ✅ Follows HTTP redirects to find final destination
- ✅ Input validation and error handling
- ✅ CORS support for browser requests
- ✅ Timeout protection (10 seconds)
- ✅ Returns detailed response with status codes

## Setup & Installation

### Prerequisites

- Node.js (v16 or higher)
- A Cloudflare account
- Wrangler CLI

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Configure Your Worker (Optional)

Edit `wrangler.toml` to customize:
- Worker name
- Environment settings
- Custom domains

## Development

### Local Development

Start the development server:

```bash
npm run dev
```

This will start a local server at `http://localhost:8787`

### Test the Worker

```bash
# Test with a redirect URL
curl "http://localhost:8787?url=https://bit.ly/example"

# Test with a direct URL
curl "http://localhost:8787?url=https://google.com"
```

## Deployment

### Deploy to Development Environment

```bash
npm run deploy:staging
```

### Deploy to Production

```bash
npm run deploy:production
```

### Quick Deploy (uses default environment)

```bash
npm run deploy
```

## API Usage

### Request

```
GET https://your-worker.your-subdomain.workers.dev?url=<URL_TO_RESOLVE>
```

### Response

```json
{
  "original_url": "https://bit.ly/example",
  "final_url": "https://example.com/final-destination",
  "status_code": 200,
  "redirected": true
}
```

### Error Response

```json
{
  "error": "Missing 'url' parameter",
  "message": "Usage: ?url=https://example.com"
}
```

## Examples

### JavaScript/Fetch

```javascript
const response = await fetch('https://your-worker.workers.dev?url=https://bit.ly/example');
const data = await response.json();
console.log(data.final_url);
```

### cURL

```bash
curl "https://your-worker.workers.dev?url=https://bit.ly/example"
```

## Security

- Only HTTP and HTTPS protocols are allowed
- 10-second timeout to prevent hanging requests
- Input validation for all parameters
- CORS headers included for browser compatibility

## License

MIT 
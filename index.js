/**
 * Cloudflare Worker to fetch URL contents and return in JSON format
 * Includes bot detection avoidance techniques
 */

// Common browser User-Agents to rotate through
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
];

// Get a random User-Agent
const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

// Create realistic browser headers
const createBrowserHeaders = (url) => {
  const urlObj = new URL(url);

  return {
    "User-Agent": getRandomUserAgent(),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    Referer: `https://${urlObj.hostname}/`,
  };
};

// Add CORS headers to response
const addCorsHeaders = (response) => {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

// Fetch URL with bot detection avoidance
const fetchWithAvoidance = async (url, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const headers = createBrowserHeaders(url);

      // Add some randomization to avoid patterns
      if (Math.random() > 0.5) {
        headers["X-Forwarded-For"] = `${Math.floor(
          Math.random() * 255
        )}.${Math.floor(Math.random() * 255)}.${Math.floor(
          Math.random() * 255
        )}.${Math.floor(Math.random() * 255)}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        cf: {
          // Cloudflare-specific settings
          cacheTtl: 300,
          cacheEverything: true,
        },
      });

      // Check if we got blocked by Cloudflare or similar
      if (response.status === 403 || response.status === 503) {
        if (attempt < retries) {
          // Wait before retry with exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
          continue;
        }
      }

      return response;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
};

// Determine content type and process accordingly
const processContent = async (response, url) => {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const jsonContent = await response.json();
      return {
        success: true,
        url,
        contentType: "application/json",
        content: jsonContent,
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      };
    } else if (
      contentType.includes("text/html") ||
      contentType.includes("text/plain")
    ) {
      const textContent = await response.text();
      return {
        success: true,
        url,
        contentType,
        content: textContent,
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      };
    } else {
      // For binary content, convert to base64
      const arrayBuffer = await response.arrayBuffer();
      const base64Content = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      );

      return {
        success: true,
        url,
        contentType,
        content: base64Content,
        encoding: "base64",
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      };
    }
  } catch (error) {
    return {
      success: false,
      url,
      error: `Failed to process content: ${error.message}`,
      contentType,
      status: response.status,
    };
  }
};

// Main handler
const handleRequest = async (request) => {
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Get target URL from query parameter or POST body
  let targetUrl;

  if (request.method === "GET") {
    targetUrl = url.searchParams.get("url");
  } else if (request.method === "POST") {
    try {
      const body = await request.json();
      targetUrl = body.url;
    } catch (error) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            success: false,
            error: "Invalid JSON in request body",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }
  }

  if (!targetUrl) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameter: url",
          usage: {
            GET: "/?url=https://example.com",
            POST: '/ with JSON body: {"url": "https://example.com"}',
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }

  // Validate URL
  try {
    new URL(targetUrl);
  } catch (error) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          success: false,
          error: "Invalid URL format",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }

  try {
    // Fetch the target URL with bot detection avoidance
    const response = await fetchWithAvoidance(targetUrl);

    if (!response.ok && response.status !== 404) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            url: targetUrl,
            status: response.status,
          }),
          {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }

    // Process the content
    const result = await processContent(response, targetUrl);

    return addCorsHeaders(
      new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (error) {
    return addCorsHeaders(
      new Response(
        JSON.stringify({
          success: false,
          error: error.message,
          url: targetUrl,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }
};

// Export the handler for Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  },
};

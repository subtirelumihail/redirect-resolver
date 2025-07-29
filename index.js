export default {
  async fetch(request) {
    try {
      // Handle CORS preflight requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      const url = new URL(request.url).searchParams.get("url");

      // Validate URL parameter
      if (!url) {
        return new Response(
          JSON.stringify({
            error: "Missing 'url' parameter. Usage: ?url=https://example.com",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Validate URL format
      let targetUrl;
      try {
        targetUrl = new URL(url);
      } catch {
        return new Response(
          JSON.stringify({
            error: "Invalid URL format. Please provide a valid URL.",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Only allow HTTP and HTTPS protocols
      if (!["http:", "https:"].includes(targetUrl.protocol)) {
        return new Response(
          JSON.stringify({
            error: "Only HTTP and HTTPS URLs are supported.",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Enhanced fetch for Google News and other redirects
      const finalUrl = await this.resolveRedirects(url);

      return new Response(
        JSON.stringify({
          original_url: url,
          final_url: finalUrl.url,
          status_code: finalUrl.status,
          redirected: url !== finalUrl.url,
          redirect_count: finalUrl.redirectCount,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Failed to resolve URL",
          message: error.message,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },

  async resolveRedirects(url, maxRedirects = 15) {
    let currentUrl = url;
    let redirectCount = 0;
    let finalStatus = 200;

    // Special handling for Google News RSS URLs
    if (currentUrl.includes("news.google.com/rss/articles/")) {
      const decodedUrl = await this.handleGoogleNewsRSS(currentUrl);
      if (decodedUrl && decodedUrl !== currentUrl) {
        return {
          url: decodedUrl,
          status: 200,
          redirectCount: 1,
        };
      }
    }

    for (let i = 0; i < maxRedirects; i++) {
      try {
        // Use different strategies based on the URL
        let response;

        if (currentUrl.includes("news.google.com")) {
          response = await this.fetchGoogleNewsUrl(currentUrl);
        } else {
          response = await this.fetchRegularUrl(currentUrl);
        }

        finalStatus = response.status;

        // Check if it's a redirect response
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("Location");
          if (location) {
            // Handle relative URLs
            const newUrl = new URL(location, currentUrl);
            currentUrl = newUrl.href;
            redirectCount++;
            continue;
          }
        }

        // For successful responses, try to extract final URLs from content
        if (response.status === 200) {
          const extractedUrl = await this.extractUrlFromResponse(
            response,
            currentUrl
          );
          if (extractedUrl && extractedUrl !== currentUrl) {
            currentUrl = extractedUrl;
            redirectCount++;
            continue;
          }
        }

        // No more redirects, we've reached the final destination
        break;
      } catch (error) {
        // If we hit an error but have made some progress, return what we have
        if (redirectCount > 0) {
          break;
        }
        throw error;
      }
    }

    return {
      url: currentUrl,
      status: finalStatus,
      redirectCount,
    };
  },

  async handleGoogleNewsRSS(url) {
    try {
      // Extract the article ID
      const match = url.match(/\/articles\/([A-Za-z0-9_-]+)/);
      if (!match) return null;

      const articleId = match[1];

      // Try to decode CBM-prefixed IDs
      if (articleId.startsWith("CBM")) {
        const decodedUrl = this.decodeCBMUrl(articleId);
        if (decodedUrl) return decodedUrl;
      }

      // Use Google's redirect service for the article
      const redirectUrl = `https://news.google.com/articles/${articleId}?hl=en&gl=US`;

      try {
        const response = await fetch(redirectUrl, {
          method: "HEAD", // Just get headers to avoid content parsing
          headers: {
            "User-Agent": "GoogleBot/2.1 (+http://www.google.com/bot.html)",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("Location");
          if (location && !location.includes("google.com")) {
            return location;
          }
        }
      } catch (e) {
        // If that fails, try alternative approach
      }

      return null;
    } catch (error) {
      console.error("Failed to handle Google News RSS URL:", error);
      return null;
    }
  },

  decodeCBMUrl(articleId) {
    try {
      // Remove CBM prefix
      let encoded = articleId.substring(3);

      // Add base64 padding
      while (encoded.length % 4) {
        encoded += "=";
      }

      // Replace URL-safe characters
      encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");

      // Decode base64
      const decoded = atob(encoded);

      // Look for URLs in the decoded content
      const urlRegex =
        /https?:\/\/(?:[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})+/g;
      const urls = decoded.match(urlRegex);

      if (urls && urls.length > 0) {
        // Return the first non-Google URL
        for (const foundUrl of urls) {
          if (
            !foundUrl.includes("google.com") &&
            !foundUrl.includes("youtube.com")
          ) {
            return foundUrl;
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Failed to decode CBM URL:", error);
      return null;
    }
  },

  async fetchGoogleNewsUrl(url) {
    return fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  },

  async fetchRegularUrl(url) {
    return fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  },

  async extractUrlFromResponse(response, currentUrl) {
    try {
      const text = await response.text();

      // Patterns to find redirect URLs
      const patterns = [
        /window\.location\.href\s*=\s*["']([^"']+)["']/,
        /window\.location\s*=\s*["']([^"']+)["']/,
        /location\.href\s*=\s*["']([^"']+)["']/,
        /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=([^"'>]+)["']?/i,
        /data-n-href=["']([^"']+)["']/,
        /"url":"([^"]+)"/,
        /href="(https?:\/\/[^"]+)"[^>]*data-n-href/,
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          let extractedUrl = match[1];

          // Clean up the URL
          extractedUrl = extractedUrl
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\\u003d/g, "=")
            .replace(/\\u0026/g, "&")
            .replace(/\\/g, "");

          // Validate and return if it's a different, valid URL
          if (
            extractedUrl.startsWith("http") &&
            extractedUrl !== currentUrl &&
            !extractedUrl.includes("google.com/sorry")
          ) {
            return decodeURIComponent(extractedUrl);
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Failed to extract URL from response:", error);
      return null;
    }
  },
};

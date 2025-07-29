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

  async resolveRedirects(url, maxRedirects = 10) {
    let currentUrl = url;
    let redirectCount = 0;
    let finalStatus = 200;

    // First, check if it's a Google News RSS article URL and try to decode it
    if (currentUrl.includes("news.google.com/rss/articles/")) {
      const decodedUrl = this.decodeGoogleNewsRSSUrl(currentUrl);
      if (decodedUrl && decodedUrl !== currentUrl) {
        currentUrl = decodedUrl;
        redirectCount++;
      }
    }

    for (let i = 0; i < maxRedirects; i++) {
      try {
        // Enhanced headers for better compatibility with Google News and other services
        const response = await fetch(currentUrl, {
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
          redirect: "manual", // Handle redirects manually
          signal: AbortSignal.timeout(15000), // 15 second timeout
        });

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

        // For Google News specifically, check if we need to extract the actual URL
        if (currentUrl.includes("news.google.com") && response.status === 200) {
          const extractedUrl = await this.extractGoogleNewsUrl(
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

  decodeGoogleNewsRSSUrl(url) {
    try {
      // Extract the article ID from Google News RSS URLs
      const match = url.match(/\/articles\/([A-Za-z0-9_-]+)/);
      if (!match) return null;

      const articleId = match[1];

      // Google News RSS article IDs often start with "CBM" and contain base64-encoded data
      if (articleId.startsWith("CBM")) {
        try {
          // Remove the CBM prefix and decode
          const encodedData = articleId.substring(3);

          // Add padding if needed for base64
          let paddedData = encodedData;
          while (paddedData.length % 4) {
            paddedData += "=";
          }

          // Replace URL-safe base64 characters
          paddedData = paddedData.replace(/-/g, "+").replace(/_/g, "/");

          // Decode base64
          const decodedBytes = atob(paddedData);

          // Look for URL patterns in the decoded data
          const urlPattern = /https?:\/\/[^\s<>"']+/g;
          const urls = decodedBytes.match(urlPattern);

          if (urls && urls.length > 0) {
            // Return the first valid URL found
            return urls[0];
          }
        } catch (decodeError) {
          console.error(
            "Failed to decode Google News article ID:",
            decodeError
          );
        }
      }

      // Alternative: Try to construct a direct Google News article URL
      return `https://news.google.com/articles/${articleId}`;
    } catch (error) {
      console.error("Failed to process Google News RSS URL:", error);
      return null;
    }
  },

  async extractGoogleNewsUrl(response, currentUrl) {
    try {
      // For Google News, sometimes we need to parse the response to find the actual article URL
      const text = await response.text();

      // Look for common patterns in Google News redirects
      const urlPatterns = [
        /data-n-href="([^"]+)"/,
        /href="(https?:\/\/[^"]*)"[^>]*data-n-href/,
        /<a[^>]+href="(https?:\/\/(?!news\.google\.com)[^"]+)"/,
        /window\.location\.href\s*=\s*["']([^"']+)["']/,
        /"url":"(https?:\/\/[^"]+)"/,
        /data-url="(https?:\/\/[^"]+)"/,
      ];

      for (const pattern of urlPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const extractedUrl = match[1];
          // Decode HTML entities and URL encoding
          const decodedUrl = extractedUrl
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\\u003d/g, "=")
            .replace(/\\u0026/g, "&");

          // Validate it's a proper URL and not just a Google News URL
          if (
            decodedUrl.startsWith("http") &&
            !decodedUrl.includes("news.google.com")
          ) {
            return decodeURIComponent(decodedUrl);
          }
        }
      }

      // If no URL found in content, try URL parameter extraction
      const urlObj = new URL(currentUrl);
      const urlParam = urlObj.searchParams.get("url");
      if (urlParam && urlParam.startsWith("http")) {
        return decodeURIComponent(urlParam);
      }
    } catch (error) {
      // If extraction fails, just return the current URL
      console.error("Failed to extract Google News URL:", error);
    }

    return null;
  },
};

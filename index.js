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

      // Special handling for Google News URLs
      if (
        url.includes("news.google.com") &&
        (url.includes("/articles/") || url.includes("/rss/articles/"))
      ) {
        const decodedUrl = await this.decodeGoogleNewsUrl(url);
        if (decodedUrl && decodedUrl !== url) {
          return new Response(
            JSON.stringify({
              original_url: url,
              final_url: decodedUrl,
              status_code: 200,
              redirected: true,
              redirect_count: 1,
              method: "google_news_decode",
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }
      }

      // Enhanced fetch for other redirects
      const finalUrl = await this.resolveRedirects(url);

      return new Response(
        JSON.stringify({
          original_url: url,
          final_url: finalUrl.url,
          status_code: finalUrl.status,
          redirected: url !== finalUrl.url,
          redirect_count: finalUrl.redirectCount,
          method: "standard_redirect",
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

  /**
   * Google News URL decoder based on the working implementation
   * from https://gist.github.com/huksley/bc3cb046157a99cd9d1517b32f91a99e
   */
  async decodeGoogleNewsUrl(sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      const path = url.pathname.split("/");

      // Check if this is a Google News article URL
      if (
        url.hostname === "news.google.com" &&
        path.length > 1 &&
        (path[path.length - 2] === "articles" ||
          (path.includes("rss") && path.includes("articles")))
      ) {
        // Extract the base64 encoded part
        let base64;
        if (path.includes("rss")) {
          // Handle RSS URLs: /rss/articles/CBM...
          const articlesIndex = path.indexOf("articles");
          if (articlesIndex >= 0 && articlesIndex + 1 < path.length) {
            base64 = path[articlesIndex + 1].split("?")[0]; // Remove query params
          }
        } else {
          // Handle direct article URLs: /articles/CBM...
          base64 = path[path.length - 1].split("?")[0]; // Remove query params
        }

        if (!base64) return sourceUrl;

        let str = atob(base64);

        // Check for known prefixes and suffixes
        const prefix = String.fromCharCode(0x08, 0x13, 0x22);
        if (str.startsWith(prefix)) {
          str = str.substring(prefix.length);
        }

        const suffix = String.fromCharCode(0xd2, 0x01, 0x00);
        if (str.endsWith(suffix)) {
          str = str.substring(0, str.length - suffix.length);
        }

        // Parse length bytes and extract URL
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
          bytes[i] = str.charCodeAt(i);
        }

        const len = bytes[0];
        if (len >= 0x80) {
          // Two-byte length encoding
          str = str.substring(2, len + 2);
        } else {
          // One-byte length encoding
          str = str.substring(1, len + 1);
        }

        // Check if this is a new style encoding (AU_yqL prefix)
        if (str.startsWith("AU_yqL")) {
          // Use Google's batchexecute API for new encoding
          const decodedUrl = await this.fetchDecodedBatchExecute(base64);
          return decodedUrl;
        }

        // Return the decoded URL for old style encoding
        return str;
      }

      return sourceUrl;
    } catch (error) {
      console.error("Failed to decode Google News URL:", error);
      return sourceUrl;
    }
  },

  /**
   * Uses Google's undocumented batchexecute protocol to decode new-style URLs
   */
  async fetchDecodedBatchExecute(id) {
    try {
      const s =
        '[[["Fbv4je","[\\"garturlreq\\",[[\\"en-US\\",\\"US\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],null,null,1,1,\\"US:en\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],\\"en-US\\",\\"US\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"' +
        id +
        '\\"]",null,"generic"]]]';

      const response = await fetch(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
            Referrer: "https://news.google.com/",
          },
          body: "f.req=" + encodeURIComponent(s),
          method: "POST",
          signal: AbortSignal.timeout(10000),
        }
      );

      const responseText = await response.text();

      const header = '[\\"garturlres\\",\\"';
      const footer = '\\",';

      if (!responseText.includes(header)) {
        throw new Error("Header not found in response");
      }

      const start = responseText.substring(
        responseText.indexOf(header) + header.length
      );
      if (!start.includes(footer)) {
        throw new Error("Footer not found in response");
      }

      const url = start.substring(0, start.indexOf(footer));
      return url;
    } catch (error) {
      console.error("Failed to fetch decoded URL from batchexecute:", error);
      throw error;
    }
  },

  async resolveRedirects(url, maxRedirects = 10) {
    let currentUrl = url;
    let redirectCount = 0;
    let finalStatus = 200;

    for (let i = 0; i < maxRedirects; i++) {
      try {
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
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
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
};

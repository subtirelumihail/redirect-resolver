const fetchDecodedBatchExecute = async (id) => {
  try {
    const s =
      '[[["Fbv4je","[\\"garturlreq\\",[[\\"en-US\\",\\"US\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],null,null,1,1,\\"US:en\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],\\"en-US\\",\\"US\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"' +
      id +
      '\\"]",null,"generic"]]]';

    const response = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute?" +
        "rpcids=Fbv4je",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          Referrer: "https://news.google.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: "f.req=" + encodeURIComponent(s),
        method: "POST",
      }
    );

    const responseText = await response.text();

    // Remove the security prefix )]}' if present
    let cleanResponse = responseText;
    if (cleanResponse.startsWith(")]}'\n\n")) {
      cleanResponse = cleanResponse.substring(6);
    }

    // Try to parse the JSON response
    try {
      const parsed = JSON.parse(cleanResponse);

      // Look for the URL in the parsed response structure
      if (parsed && Array.isArray(parsed)) {
        for (const item of parsed) {
          if (Array.isArray(item) && item.length >= 3) {
            const data = item[2];
            if (typeof data === "string") {
              try {
                const innerParsed = JSON.parse(data);
                if (Array.isArray(innerParsed) && innerParsed.length >= 2) {
                  const url = innerParsed[1];
                  if (typeof url === "string" && url.startsWith("http")) {
                    return url;
                  }
                }
              } catch (e) {
                // Continue searching
              }
            }
          }
        }
      }
    } catch (parseError) {
      // Fallback to the original header/footer method
      const header = '[\\"garturlres\\",\\"';
      const footer = '\\",';
      if (cleanResponse.includes(header)) {
        const start = cleanResponse.substring(
          cleanResponse.indexOf(header) + header.length
        );
        if (start.includes(footer)) {
          const url = start.substring(0, start.indexOf(footer));
          return url;
        }
      }
    }

    throw new Error("Google News API returned error or no URL found");
  } catch (error) {
    throw new Error("BatchExecute failed: " + error.message);
  }
};

const tryDirectGoogleNewsRedirect = async (articleUrl) => {
  try {
    const response = await fetch(articleUrl, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (
        location &&
        !location.includes("google.com") &&
        location.startsWith("http")
      ) {
        return location;
      }
    }
  } catch (error) {
    // Ignore errors and try other methods
  }
  return null;
};

const decodeCBMUrl = (base64) => {
  try {
    let str = atob(base64);

    // Check for known prefixes and remove them
    const prefixes = [
      String.fromCharCode(0x08, 0x13, 0x22), // Standard prefix
      String.fromCharCode(0x08, 0x13), // Alternative prefix
      String.fromCharCode(0x08), // Minimal prefix
    ];

    for (const prefix of prefixes) {
      if (str.startsWith(prefix)) {
        str = str.substring(prefix.length);
        break;
      }
    }

    // Check for known suffixes and remove them
    const suffixes = [
      String.fromCharCode(0xd2, 0x01, 0x00), // Standard suffix
      String.fromCharCode(0xd2, 0x01), // Alternative suffix
    ];

    for (const suffix of suffixes) {
      if (str.endsWith(suffix)) {
        str = str.substring(0, str.length - suffix.length);
        break;
      }
    }

    // Convert to bytes for length parsing
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i);
    }

    if (bytes.length === 0) return null;

    // Parse length byte(s)
    let urlStart = 1;
    let urlLength = bytes[0];

    // Handle multi-byte length encoding
    if (urlLength >= 0x80) {
      if (bytes.length < 2) return null;
      // Two-byte length encoding
      urlLength = bytes[1];
      urlStart = 2;
    }

    // Extract the URL
    if (urlStart + urlLength > str.length) {
      // Length extends beyond string, try different approach
      urlLength = str.length - urlStart;
    }

    const extractedUrl = str.substring(urlStart, urlStart + urlLength);

    // Validate the extracted URL
    if (extractedUrl && extractedUrl.startsWith("http")) {
      return extractedUrl;
    }

    // If that didn't work, try searching for HTTP URLs in the decoded data
    const urlRegex = /https?:\/\/[^\s\x00-\x1f\x7f-\x9f]+/g;
    const urls = str.match(urlRegex);

    if (urls && urls.length > 0) {
      // Return the first valid URL that's not a Google URL
      for (const url of urls) {
        if (!url.includes("google.com") && !url.includes("youtube.com")) {
          return url;
        }
      }
      // If all URLs contain google.com, return the first one anyway
      return urls[0];
    }

    return null;
  } catch (error) {
    console.error("CBM decode error:", error);
    return null;
  }
};

const decodeGoogleNewsUrl = async (sourceUrl) => {
  const url = new URL(sourceUrl);
  const path = url.pathname.split("/");

  // Handle both direct articles and RSS articles
  let articlePath = null;
  if (url.hostname === "news.google.com") {
    if (path.includes("articles")) {
      const articlesIndex = path.indexOf("articles");
      if (articlesIndex >= 0 && articlesIndex + 1 < path.length) {
        articlePath = path[articlesIndex + 1].split("?")[0]; // Remove query params
      }
    }
  }

  if (articlePath) {
    const base64 = articlePath;

    // First, try direct redirect approach
    const directUrl = `https://news.google.com/articles/${base64}`;
    const redirectedUrl = await tryDirectGoogleNewsRedirect(directUrl);
    if (redirectedUrl) {
      return redirectedUrl;
    }

    // Try to decode CBM URLs manually
    if (base64.startsWith("CBM")) {
      const decodedUrl = decodeCBMUrl(base64);
      if (
        decodedUrl &&
        decodedUrl.startsWith("http") &&
        !decodedUrl.includes("news.google.com")
      ) {
        return decodedUrl;
      }
    }

    // For AU_yqL format, try the batchexecute API
    try {
      let str = atob(base64);
      const prefix = String.fromCharCode(0x08, 0x13, 0x22);
      if (str.startsWith(prefix)) {
        str = str.substring(prefix.length);
      }

      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
      }

      if (bytes.length > 0) {
        const len = bytes[0];
        if (len >= 0x80) {
          str = str.substring(2, len + 2);
        } else {
          str = str.substring(1, len + 1);
        }

        if (str.startsWith("AU_yqL")) {
          try {
            const batchUrl = await fetchDecodedBatchExecute(base64);
            if (batchUrl && batchUrl.startsWith("http")) {
              return batchUrl;
            }
          } catch (error) {
            console.error("BatchExecute failed:", error.message);
          }
        }
      }
    } catch (decodeError) {
      console.error("Manual decode failed:", decodeError.message);
    }

    // If all else fails, return the direct Google News URL
    return directUrl;
  } else {
    return sourceUrl;
  }
};

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

      // Try Google News decoding first
      const decodedUrl = await decodeGoogleNewsUrl(url);
      if (decodedUrl !== url) {
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

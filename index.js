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

      // Fetch with timeout and redirect following
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      return new Response(
        JSON.stringify({
          original_url: url,
          final_url: response.url,
          status_code: response.status,
          redirected: url !== response.url,
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
};

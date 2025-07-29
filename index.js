export default {
  async fetch(request) {
    const url = new URL(request.url).searchParams.get("url");
    const response = await fetch(url, { redirect: "follow" });
    return new Response(JSON.stringify({ final_url: response.url }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};

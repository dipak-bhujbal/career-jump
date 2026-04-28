export interface Env {
  WORKER_SECRET: string;
}

type ProxyPayload = {
  url?: string;
  method?: string;
  payload?: unknown;
  headers?: Record<string, string>;
};

type UserAgentProfile = {
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
};

const USER_AGENT_POOL: UserAgentProfile[] = [
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"135\", \"Google Chrome\";v=\"135\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"134\", \"Google Chrome\";v=\"134\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"133\", \"Google Chrome\";v=\"133\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Linux\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"131\", \"Google Chrome\";v=\"131\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    secChUa: "\"Safari\";v=\"17\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    secChUa: "\"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  },
  {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
    secChUa: "\"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Linux\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function randomUserAgent(): UserAgentProfile {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const secret = request.headers.get("X-Worker-Secret");
    if (!secret || secret !== env.WORKER_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    let payload: ProxyPayload;
    try {
      payload = await request.json<ProxyPayload>();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!payload.url) {
      return json({ error: "Missing target URL" }, 400);
    }

    const ua = randomUserAgent();
    const upstream = await fetch(payload.url, {
      method: payload.method ?? "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "Sec-CH-UA": ua.secChUa,
        "Sec-CH-UA-Mobile": ua.secChUaMobile,
        "Sec-CH-UA-Platform": ua.secChUaPlatform,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": ua.userAgent,
        ...(payload.headers ?? {}),
      },
      body: payload.payload ? JSON.stringify(payload.payload) : undefined,
    });

    const retryAfter = upstream.headers.get("Retry-After");
    const bodyText = await upstream.text();
    let data: unknown = null;

    if (upstream.ok) {
      try {
        data = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        data = null;
      }
    }

    return json({
      status: upstream.status,
      retryAfter,
      data,
      bodyText: upstream.ok ? null : bodyText,
    });
  },
};

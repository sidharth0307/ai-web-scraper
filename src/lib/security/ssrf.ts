import dns from "node:dns/promises";
import net from "node:net";

export async function validateSafeTargetUrl(targetUrl: URL): Promise<void> {
  const protocol = targetUrl.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("INVALID_PROTOCOL: Only HTTP and HTTPS protocols are permitted.");
  }

  const hostname = targetUrl.hostname.toLowerCase();

  // 1. Literal host checks
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new Error("FORBIDDEN_HOST: Access to loopback addresses is prohibited.");
  }

  // 2. Resolve DNS to get actual target IP addresses
  const resolved = await dns.lookup(hostname, { all: true });

  if (!resolved || resolved.length === 0) {
    throw new Error("DNS_RESOLUTION_FAILED: Domain could not be resolved.");
  }

  for (const record of resolved) {
    const ip = record.address;
    const ipType = net.isIP(ip);

    if (ipType === 4) {
      const [o1, o2] = ip.split(".").map((n) => parseInt(n, 10));

      // 10.0.0.0/8, 127.0.0.0/8, 0.0.0.0/8
      if (o1 === 10 || o1 === 127 || o1 === 0) {
        throw new Error("FORBIDDEN_IP: Private network access prohibited.");
      }
      // 172.16.0.0/12
      if (o1 === 172 && o2 >= 16 && o2 <= 31) {
        throw new Error("FORBIDDEN_IP: Private network access prohibited.");
      }
      // 192.168.0.0/16
      if (o1 === 192 && o2 === 168) {
        throw new Error("FORBIDDEN_IP: Private network access prohibited.");
      }
      // 169.254.0.0/16 (Link-local / AWS & GCP Instance Metadata)
      if (o1 === 169 && o2 === 254) {
        throw new Error("FORBIDDEN_IP: Cloud metadata endpoint access prohibited.");
      }
    } else if (ipType === 6) {
      // IPv6 Loopback (::1), Link-local (fe80::), Unique local (fc00:: / fd00::)
      const normalized = ip.toLowerCase();
      if (
        normalized === "::1" ||
        normalized.startsWith("fe80:") ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd")
      ) {
        throw new Error("FORBIDDEN_IP: Private IPv6 network access prohibited.");
      }
    }
  }
}
declare module "cloudflare:sockets" {
  export function connect(address: { hostname: string; port: number }): {
    opened: Promise<unknown>;
    closed: Promise<void>;
    close(): Promise<void>;
  };
}

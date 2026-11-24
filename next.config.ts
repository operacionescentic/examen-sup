import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App 100% dinámica (bandeja en tiempo real): sin cacheComponents.
  // Librerías de correo de Node: no empaquetar
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
  experimental: {
    serverActions: {
      bodySizeLimit: "4.5mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

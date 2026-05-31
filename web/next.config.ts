import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 워크스페이스의 package-lock.json이 루트로 오인되지 않도록
  // 이 web 디렉터리를 Turbopack 루트로 고정한다. (Vercel 배포 시엔 no-op)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
